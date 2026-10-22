import { mkdirSync, writeFileSync } from 'fs';
import { gemoji } from 'gemoji';

// GitHub's emoji shortcodes, for the composer's ":" autocomplete (see src/guest-preload.ts), as
// [emoji, space-separated names, space-separated tags] in gemoji's order, which puts common faces first.
mkdirSync('dist', { recursive: true });
writeFileSync('dist/emoji.json', JSON.stringify(gemoji.map((g) => [g.emoji, g.names.join(' '), g.tags.join(' ')])));
