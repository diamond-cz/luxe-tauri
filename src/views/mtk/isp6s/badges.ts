/**
 * Map Isp6s.toml schema + a flat AE_TAG → value map (from the current image's
 * TOML) into the badge values shown by Isp6sAeVisual.
 *
 * Equivalent of hiz's `_apply_toml_mapping` + the formulas spelled out in
 * `configs/Isp6s.toml` headers (`tar_abl_mt_hs`, `Cal`, `LCE_Gain`).
 */
import type { Isp6sSchemaRoot } from "@/ipc/cppParser";

const NORMAL_SUBS = ["MainT", "HS", "ABL", "NS"] as const;
type NormalSub = (typeof NORMAL_SUBS)[number];

/** Numeric lookup. Returns NaN when the key is missing or unparseable. */
function num(table: Record<string, string>, key: string | undefined | null): number {
  if (!key) return NaN;
  const v = table[key];
  if (v === undefined || v === null || v === "") return NaN;
  const f = parseFloat(v);
  return Number.isFinite(f) ? f : NaN;
}

/** Pretty-print a numeric badge value: integers stay int, floats keep 2 dp. */
function fmt(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2);
}

export interface NormalBadges {
  cwr:           string;
  tar_abl_mt_hs: string;
  cal:           string;
  perSub: Record<NormalSub, { wt: string; tar: string; wtKey?: string; tarKey?: string }>;
}

export function computeNormalBadges(
  schema:   Isp6sSchemaRoot,
  tomlData: Record<string, string>,
): NormalBadges {
  const normal = (schema.card?.Normal ?? {}) as any;
  const cwrKey = normal.CWR as string | undefined;
  const cwr    = num(tomlData, cwrKey);

  // Per sub-card raw WT / Tar.
  const perSub = {} as NormalBadges["perSub"];
  for (const name of NORMAL_SUBS) {
    const wtKey  = normal.wt?.[name]  as string | undefined;
    const tarKey = normal.tar?.[name] as string | undefined;
    const wt  = num(tomlData, wtKey);
    const tar = num(tomlData, tarKey);
    perSub[name] = { wt: fmt(wt), tar: fmt(tar), wtKey, tarKey };
  }

  // tar_abl_mt_hs = (ABL.tar*ABL.wt + MT.tar*MT.wt + HS.tar*HS.wt)
  //               / (ABL.wt + MT.wt + HS.wt)
  // hiz "MT" in this formula refers to MainT.
  const abl_wt  = num(tomlData, normal.wt?.ABL);
  const mt_wt   = num(tomlData, normal.wt?.MainT);
  const hs_wt   = num(tomlData, normal.wt?.HS);
  const abl_tar = num(tomlData, normal.tar?.ABL);
  const mt_tar  = num(tomlData, normal.tar?.MainT);
  const hs_tar  = num(tomlData, normal.tar?.HS);
  const denom   = (abl_wt || 0) + (mt_wt || 0) + (hs_wt || 0);
  const tar_abl_mt_hs = denom > 0
    ? ((abl_tar || 0) * (abl_wt || 0)
      + (mt_tar  || 0) * (mt_wt  || 0)
      + (hs_tar  || 0) * (hs_wt  || 0)) / denom
    : NaN;

  // Cal = (tar_abl_mt_hs * (1024 - NS.wt) + NS.tar * NS.wt) / 1024
  const ns_wt  = num(tomlData, normal.wt?.NS);
  const ns_tar = num(tomlData, normal.tar?.NS);
  const cal = Number.isFinite(tar_abl_mt_hs) && Number.isFinite(ns_wt) && Number.isFinite(ns_tar)
    ? (tar_abl_mt_hs * (1024 - ns_wt) + ns_tar * ns_wt) / 1024
    : NaN;

  return {
    cwr:           fmt(cwr),
    tar_abl_mt_hs: fmt(tar_abl_mt_hs),
    cal:           fmt(cal),
    perSub,
  };
}

export interface FaceTouchBadges {
  cwr:       string;
  lce_gain:  string;
  face:      { wt: string; fbt: string; flt: string; wtKey?: string; fbtKey?: string; fltKey?: string };
  touch:     { wt: string; tar: string;  wtKey?: string; tarKey?: string };
}

export function computeFaceTouchBadges(
  schema:   Isp6sSchemaRoot,
  tomlData: Record<string, string>,
): FaceTouchBadges {
  const ft = (schema.card?.face_touch ?? {}) as any;
  const cwr      = num(tomlData, ft.CWR);
  const lceNum   = num(tomlData, ft.LCE_Gain_num);
  const lceDen   = num(tomlData, ft.LCE_Gain_den);
  const lce_gain = Number.isFinite(lceNum) && Number.isFinite(lceDen) && lceDen !== 0
    ? lceNum / lceDen
    : 0;

  const faceCfg  = ft.Face  ?? {};
  const touchCfg = ft.Touch ?? {};

  const maxOf = (keys: string[] | undefined): number => {
    if (!keys || keys.length === 0) return NaN;
    let m = -Infinity;
    let any = false;
    for (const k of keys) {
      const v = num(tomlData, k);
      if (Number.isFinite(v)) { m = Math.max(m, v); any = true; }
    }
    return any ? m : NaN;
  };

  return {
    cwr:      fmt(cwr),
    lce_gain: fmt(lce_gain),
    face: {
      wt:     fmt(maxOf(faceCfg.wt_max)),
      fbt:    fmt(num(tomlData, faceCfg.FBT)),
      flt:    fmt(num(tomlData, faceCfg.FLT)),
      wtKey:  (faceCfg.wt_max ?? []).join(", ") || undefined,
      fbtKey: faceCfg.FBT,
      fltKey: faceCfg.FLT,
    },
    touch: {
      wt:     fmt(maxOf(touchCfg.wt_max)),
      tar:    fmt(num(tomlData, touchCfg.tar)),
      wtKey:  (touchCfg.wt_max ?? []).join(", ") || undefined,
      tarKey: touchCfg.tar,
    },
  };
}
