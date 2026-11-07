// Usage: BACKUP_PASSPHRASE=... node src/restore.js <backup.wbk> <target-data-dir>
import { restoreBackup } from './backup.js';

const [file, target] = process.argv.slice(2);
const pass = process.env.BACKUP_PASSPHRASE;
if (!file || !target || !pass) {
  console.error('Usage: BACKUP_PASSPHRASE=... node src/restore.js <backup.wbk> <target-data-dir>');
  process.exit(1);
}
try {
  const { manifest, fileCount } = restoreBackup(file, pass, target);
  console.log(`Restored ${fileCount} files from a backup made ${manifest.createdAt} into ${target}`);
  if (manifest.skippedUploads?.length) console.log('Attachments not included in the backup:', manifest.skippedUploads.join(', '));
} catch (err) {
  console.error('Restore failed:', err.message);
  process.exit(1);
}
