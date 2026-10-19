import { z } from "zod";

// Larger bodies are only accepted by the roundtable routes that carry signed state.
export const roundtableCheckpointSchema = z.string().min(1).max(196608).optional();
export const ROUNDTABLE_BODY_LIMIT = 262144;
