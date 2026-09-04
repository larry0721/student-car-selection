import artifactJson from "./published-vehicle-intelligence/golden-set-v1.runtime.json";
import { loadPublishedVehicleAuthorityArtifact } from "../src/vehicle-intelligence/published-vehicle-authority-artifact";

const artifact = loadPublishedVehicleAuthorityArtifact(JSON.stringify(artifactJson));

export const activePublishedVehicleIntelligence = [...artifact.publications];
