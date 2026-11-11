// 增量更新：比較舊版與新版的檔案清單（路徑 → SHA-256），只下載新增或內容改變的檔案。
// 若系統核心（預設為 runtime/，或呼叫端指定的前綴）有變動，fullRequired 為 true，呼叫端應整包下載。
// 注意：@judge/core 已是獨立的版本化依賴，隨應用程式發版，不屬於模組檔案，因此預設不再包含 packages/core/。

export type FileManifest = Record<string, string>;

export interface UpdatePlan {
  download: string[];
  remove: string[];
  unchanged: string[];
  /** 共用核心或系統核心檔案有變動 → 需要整包下載。 */
  fullRequired: boolean;
}

export interface UpdateDiffOptions {
  /** 屬於「系統核心」的路徑前綴；其中任一檔案改變就整包下載。 */
  corePrefixes?: string[];
}

const DEFAULT_CORE_PREFIXES = ['runtime/'];

export function planUpdate(oldM: FileManifest, newM: FileManifest, opts: UpdateDiffOptions = {}): UpdatePlan {
  const core = opts.corePrefixes ?? DEFAULT_CORE_PREFIXES;
  const download: string[] = [];
  const unchanged: string[] = [];
  for (const [path, hash] of Object.entries(newM)) {
    if (oldM[path] === hash) unchanged.push(path);
    else download.push(path);
  }
  const remove = Object.keys(oldM).filter((p) => !(p in newM));
  const changed = [...download, ...remove];
  const fullRequired = changed.some((p) => core.some((c) => p.startsWith(c)));
  return { download: download.sort(), remove: remove.sort(), unchanged: unchanged.sort(), fullRequired };
}
