import type { Vehicle } from "@/types/vehicle";

export type VehiclePhotoState = "photo" | "fallback";

export function getVehiclePhotoState(vehicle: Pick<Vehicle, "imageUrl">, imageFailed: boolean): VehiclePhotoState {
  return vehicle.imageUrl && !imageFailed ? "photo" : "fallback";
}
