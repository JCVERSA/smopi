/**
 * Shared client-side type contract.
 *
 * These types mirror the JSON payloads emitted by `server.ts` (and
 * `server/smopi.ts`). When a server response shape changes, update it here so
 * `tsc --noEmit` catches drifting call sites.
 */

/**
 * File category emitted by `categoryFor()` in server.ts.
 * Note the plural forms — the client icon mapping must match exactly.
 */
export type FileCategory = 'archives' | 'images' | 'documents' | 'other';

/** One entry of the `files` array returned by `GET /api/files`. */
export interface SharedFile {
  name: string;
  size: number;
  /** Human-readable size, e.g. "4.9 KB". */
  size_human: string;
  /** Formatted as "YYYY-MM-DD HH:mm" (UTC). */
  mtime: string;
  /** Display type: a MIME type ("text/plain") or bare extension ("BIN"). */
  type: string;
  category: FileCategory;
}

/** Response body of `GET /api/status`. */
export interface ShareStatus {
  active_downloads: number;
  bytes_total: number;
  bytes_total_human: string;
  downloads_total: number;
  one_time: boolean;
  /** Seconds until the share expires; 0 when expired or no expiry set. */
  remaining: number;
  stopped: boolean;
  stop_reason: string;
  authorized: boolean;
  is_owner: boolean;
  /** Present only when the caller is the share owner. */
  share_password?: string;
}

/**
 * Preview state, discriminated on `type`.
 *
 * `image` / `text` / `unsupported` are returned by `GET /api/preview/:name`.
 * `error` is set client-side when that request fails or the server is
 * unreachable; the server never emits it.
 */
export type PreviewData =
  | { type: 'image'; url: string; svg?: boolean }
  | { type: 'text'; content: string }
  | { type: 'unsupported'; message: string }
  | { type: 'error'; message: string };

/** Client-only: a single file in the upload queue. */
export interface UploadItem {
  id: string;
  name: string;
  /** 0-100. */
  progress: number;
  status: 'uploading' | 'success' | 'error';
}

/** Client-only: state backing the download progress modal. */
export interface DownloadProgressState {
  visible: boolean;
  name: string;
  /** 0-100. */
  percent: number;
  statusText: string;
  metaText: string;
  loaded: number;
  total: number;
}

/**
 * A filesystem mutation performed by the Smopi agent.
 * Mirrors `ActionRecord` in server/smopi.ts.
 */
export interface SmopiAction {
  type:
    | 'created'
    | 'modified'
    | 'renamed'
    | 'deleted'
    | 'duplicated'
    | 'indexed'
    | 'analyzed';
  file: string;
  details?: string;
  timestamp: string;
}

/** Client-only: one turn in the Smopi chat transcript. */
export interface SmopiMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  /** Actions reported by the server for a model turn. */
  actions?: SmopiAction[];
  /** Locale-formatted clock time, e.g. "14:13". */
  timestamp: string;
  /** Display label for the backing model, e.g. "Gemini 3.8 Flash". */
  model?: string;
}

/**
 * Re-exported so consumers can import the whole UI contract from one module.
 * Defined in the component that owns the model picker.
 */
export type { PromptModel } from './components/PromptBar';
