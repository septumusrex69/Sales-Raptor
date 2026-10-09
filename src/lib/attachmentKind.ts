/**
 * WHAT KIND OF FILE AN ATTACHMENT IS, IN THE FIRM'S WORDS.
 *
 * The firm, 9 Oct, at a row of "attachment-1 … attachment-8" chips: "it doesn't show me if it's a
 * PDF or an email or what type of file this is." The sync now names an unnamed part by its type
 * (api/_lib/mime.ts, attachmentNamesOf), and every chip says what it is in a word, read off the
 * extension -- the one thing every listed name has once it has a type at all.
 *
 * NOTHING RATHER THAN A GUESS. A name with no extension -- a message synced before the rule, whose
 * stored name is a bare attachment-N -- gets no label: "File" would read as an answer.
 *
 * Pure, so a check can import it.
 */
const KINDS: Record<string, string> = {
  pdf: 'PDF',
  eml: 'Email', msg: 'Email',
  doc: 'Word', docx: 'Word', rtf: 'Word', odt: 'Word',
  xls: 'Excel', xlsx: 'Excel', xlsm: 'Excel', ods: 'Excel', csv: 'CSV',
  ppt: 'PowerPoint', pptx: 'PowerPoint',
  jpg: 'Image', jpeg: 'Image', png: 'Image', gif: 'Image', heic: 'Image', webp: 'Image', tif: 'Image', tiff: 'Image', bmp: 'Image',
  ics: 'Invite',
  zip: 'Zip', rar: 'Zip', '7z': 'Zip',
  txt: 'Text', html: 'Web page', htm: 'Web page',
  mp3: 'Audio', wav: 'Audio', m4a: 'Audio', mp4: 'Video', mov: 'Video',
}

export function attachmentKind(name: string): string | null {
  const m = /\.([a-z0-9]{1,5})$/i.exec(name.trim())
  if (!m) return null
  return KINDS[m[1].toLowerCase()] ?? m[1].toUpperCase()
}
