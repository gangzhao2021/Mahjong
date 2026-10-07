/**
 * Admin setup helper:
 *   pnpm --filter @mahjong/server admin:setup <username> <password>
 * Prints the environment variables for the admin account, including a new
 * TOTP secret to add to an authenticator app.
 */
import { generateTotpSecret, hashPassword, totpUri } from './auth';

const [username, password] = process.argv.slice(2);
if (!username || !password || password.length < 12) {
  console.error('Usage: admin:setup <username> <password>   (password: at least 12 characters)');
  process.exit(1);
}
const secret = generateTotpSecret();
console.log(`ADMIN_USERNAME=${username}`);
console.log(`ADMIN_PASSWORD_HASH=${hashPassword(password)}`);
console.log(`ADMIN_TOTP_SECRET=${secret}`);
console.log('');
console.log('Add this to your authenticator app (or enter the secret manually):');
console.log(totpUri(secret, username));
