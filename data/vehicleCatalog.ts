import vehicleCatalogData from "@/data/processed/vehicleCatalog.json";
import type { Vehicle } from "@/types/vehicle";

export const vehicleCatalog = vehicleCatalogData as unknown as Vehicle[];
