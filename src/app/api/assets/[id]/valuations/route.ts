import { NextResponse } from "next/server";
import { z } from "zod";
import { addAssetValuation, getAsset } from "@/lib/repo";
import { getPropertyValuationProvider } from "@/lib/providers/property";

const manualSchema = z.object({
  mode: z.literal("manual").default("manual"),
  valuationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  value: z.number().min(0).max(1e12),
  notes: z.string().max(1000).nullish(),
});

const automatedSchema = z.object({
  mode: z.literal("automated"),
});

const bodySchema = z.union([manualSchema, automatedSchema]);

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!/^[\w-]{1,64}$/.test(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  if (parsed.data.mode === "automated") {
    const asset = await getAsset(id);
    if (!asset) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (!asset.address) {
      return NextResponse.json(
        { error: "This asset has no address to look up." },
        { status: 400 },
      );
    }
    const provider = getPropertyValuationProvider();
    if (!provider) {
      return NextResponse.json(
        {
          error:
            "No property valuation provider is configured (set RENTCAST_API_KEY). Manual valuations always work.",
        },
        { status: 501 },
      );
    }
    const estimate = await provider.getCurrentValue(asset.address);
    if (!estimate) {
      return NextResponse.json(
        { error: "The valuation provider returned no estimate for this address." },
        { status: 502 },
      );
    }
    const valuation = await addAssetValuation(id, {
      valuationDate: estimate.asOf,
      value: estimate.value,
      valueLow: estimate.valueLow,
      valueHigh: estimate.valueHigh,
      source: "automated",
      notes: `Estimate from ${estimate.source}`,
    });
    return NextResponse.json({ valuation }, { status: 201 });
  }

  const valuation = await addAssetValuation(id, {
    valuationDate: parsed.data.valuationDate,
    value: parsed.data.value,
    source: "manual",
    notes: parsed.data.notes ?? null,
  });
  if (!valuation) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ valuation }, { status: 201 });
}
