import { call } from "./client";

export const readTextFile = (path: string) => call<string>("read_text_file", { path });
