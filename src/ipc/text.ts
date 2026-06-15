import { call } from "./client";

export const readTextFile = (path: string) => call<string>("read_text_file", { path });

export const writeTextFile = (path: string, contents: string) =>
  call<void>("write_text_file", { path, contents });

export const writeTempTextFile = (nameHint: string, contents: string) =>
  call<string>("write_temp_text_file", { nameHint, contents });
