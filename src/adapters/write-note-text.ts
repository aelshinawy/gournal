// The Write note wording that the CLI and MCP adapters share.
import type { WriteNote } from './entry-writer';

export function writeNoteText(note: WriteNote): string {
  switch (note.type) {
    case 'similarTag': return `New tag "${note.tag}". Close existing tags: ${note.close.join(', ')}`;
    case 'resolveDropped': return `Could not resolve ${note.id}: ${note.reason}`;
    case 'split': return 'Summary was too long and was split; full text is in details.';
  }
}
