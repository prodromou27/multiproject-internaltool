/* RFC 5545 line folding: a content line is at most 75 octets (bytes, not
   characters), continuation lines start with one space, and a fold must never
   split a multi-byte UTF-8 character. */
function fold(line, limit = 75) {
  const out = [];
  let current = '';
  let bytes = 0;
  for (const char of line) {                       // iterates code points, so surrogate pairs stay together
    const size = Buffer.byteLength(char, 'utf8');
    if (bytes + size > limit) {
      out.push(current);
      current = ' ';                               // the leading space counts toward the next line's limit
      bytes = 1;
    }
    current += char;
    bytes += size;
  }
  out.push(current);
  return out.join('\r\n');
}

module.exports = { fold };
