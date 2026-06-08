import { call } from "./client";

export interface FaceTableSchema {
  top_kv: Record<string, string>;
  FBT?: Record<string, string>;
  FLT?: Record<string, string>;
}

export const getFaceTableSchema = () =>
  call<FaceTableSchema>("get_face_table_schema");
