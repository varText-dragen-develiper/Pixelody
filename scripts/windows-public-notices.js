const fs = require('node:fs');
const path = require('node:path');
const { inspectContent } = require('./windows-package-policy');

function publicAssetNotice(root) {
  const source = fs.readFileSync(path.join(root, 'THIRD_PARTY_ASSETS.md'), 'utf8');
  // This private provenance inventory is useful in source, but is not a notice
  // for any distributed asset and includes private filenames and host context.
  const result = source.replace(/^## User-Provided Meme Machine Pack\r?\n[\s\S]*?(?=^## |$(?![\s\S]))/m, '');
  if (result.includes('## User-Provided Meme Machine Pack')) throw new Error('Private asset inventory was not removed from public notices.');
  inspectContent('resources/THIRD_PARTY_ASSETS.md', Buffer.from(result));
  return result;
}

function publicNoticePath(root) {
  return path.join(root, '.artifacts', 'windows-release-inputs', 'THIRD_PARTY_ASSETS.md');
}

function preparePublicAssetNotice(root) {
  const file = publicNoticePath(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, publicAssetNotice(root));
}

module.exports = { publicAssetNotice, publicNoticePath, preparePublicAssetNotice };
