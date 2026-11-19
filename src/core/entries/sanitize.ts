import type { Ref } from '../labels/refs';

/** C0 controls (all, tab and newline included), DEL, and C1 controls. ESC and the OSC and CSI starters are in here. */
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;
/** The same set, but tab (\u0009) and newline (\u000a) stay. For multi-line details. */
const CONTROL_KEEP_TEXT = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;

/** Remove every control character. For single-line fields: summary, project, repo, branch, agent, tag, ref, and search terms. */
export const stripControl = (s: string): string => s.replace(CONTROL, '');

/** Remove control characters except tab and newline. For details. */
const stripControlKeepText = (s: string): string => s.replace(CONTROL_KEEP_TEXT, '');

/** The project an entry gets when none is given or when nothing is left after stripping. */
export const DEFAULT_PROJECT = 'uncategorized';

/** Strip a project. A project with nothing left falls back to the default project. */
export const cleanProject = (s: string): string => stripControl(s) || DEFAULT_PROJECT;

/** Strip an optional single-line field. null and undefined pass through. */
export const cleanOpt = (v: string | null | undefined): string | null | undefined => (typeof v === 'string' ? stripControl(v) : v);

/** Strip details. Tab and newline stay. null and undefined pass through. */
export const cleanDetails = (v: string | null | undefined): string | null | undefined => (typeof v === 'string' ? stripControlKeepText(v) : v);

/** Strip each ref value and repo. A ref with an empty value is dropped. */
export const cleanRefs = (refs: Ref[]): Ref[] =>
  refs.map((r) => ({ ...r, value: stripControl(r.value), ...(r.repo !== undefined ? { repo: stripControl(r.repo) } : {}) }))
    .filter((r) => r.value !== '');
