import { NextResponse } from "next/server";
import { z } from "zod";
import { createAsset, getAssets, getAssetValuations } from "@/lib/repo";

const detailsSchema = z
  .object({
    propertyType: z.string().max(60).optional(),
    bedrooms: z.number().min(0).max(50).optional(),
    bathrooms: z.number().min(0).max(50).optional(),
    squareFootage: z.number().min(0).max(1_000_000).optional(),
    valuationSource: z.string().max(120).optional(),
  })
  .passthrough();

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  assetType: z.enum([
    "real_estate",
    "vehicle",
    "jewelry",
    "collectible",
    "business",
    "cash",
    "other",
  ]),
  description: z.string().max(2000).nullish(),
  address: z.string().max(300).nullish(),
  purchaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  purchasePrice: z.number().min(0).max(1e12).nullish(),
  valuationMethod: z.enum(["manual", "automated", "hybrid"]),
  currentValue: z.number().min(0).max(1e12),
  valuationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  details: detailsSchema.nullish(),
  liabilityAccountId: z.string().max(64).nullish(),
});

export async function GET() {
  const [assets, valuations] = await Promise.all([
    getAssets(),
    getAssetValuations(),
  ]);
  return NextResponse.json({ assets, valuations });
}

export async function POST(req: Request) {
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const asset = await createAsset(parsed.data);
  return NextResponse.json({ asset }, { status: 201 });
}
