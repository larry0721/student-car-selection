import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createPublishedVehicleAuthorityArtifact,
  serializePublishedVehicleAuthorityArtifact,
} from "../src/vehicle-intelligence/published-vehicle-authority-artifact";
import { loadPublishedCVRRepository } from "../src/vehicle-intelligence/published-cvr-repository";

const root = process.cwd();
const repositoryPath = join(root, "data/published-vehicle-intelligence/repositories/golden-set-v1.json");
const artifactPath = join(root, "data/published-vehicle-intelligence/golden-set-v1.runtime.json");
const repository = loadPublishedCVRRepository(readFileSync(repositoryPath, "utf8"));
const artifact = createPublishedVehicleAuthorityArtifact(repository.exportState());
writeFileSync(artifactPath, serializePublishedVehicleAuthorityArtifact(artifact), "utf8");
console.log(`${artifact.artifactId} (${artifact.publishedVehicleCount} vehicles)`);
