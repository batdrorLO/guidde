import { Inject, Injectable, Logger } from '@nestjs/common';
import fs from 'node:fs';
import { z } from 'zod';
import { AUTH_CONFIG, type AuthConfig } from './auth.config';

export interface AuthUser {
  email: string;
  name: string;
  role: string;
}

export interface StoredUser extends AuthUser {
  passwordHash: string;
}

const usersFileSchema = z.array(
  z.object({
    email: z.string().email().transform((s) => s.toLowerCase()),
    name: z.string().min(1),
    role: z.string().min(1),
    passwordHash: z.string().regex(/^\$2[aby]\$\d{2}\$.{53}$/, 'must be a bcrypt hash (use the add-user script)'),
  }),
);

/**
 * Users who may sign in, from a JSON file of bcrypt hashes. Small and auditable for
 * an internal tool; in production this would be SSO (Google Workspace / Okta) instead.
 *
 * The file is re-read when it changes, so adding, removing or re-roling someone
 * takes effect without a restart. A broken edit keeps the last good list.
 */
@Injectable()
export class UserStore {
  private readonly logger = new Logger(UserStore.name);
  private users = new Map<string, StoredUser>();
  private loadedMtimeMs = -1;

  constructor(@Inject(AUTH_CONFIG) private readonly cfg: AuthConfig) {
    // Fail fast at startup: an API nobody can sign in to is a misconfiguration.
    this.load({ throwOnError: true });
  }

  find(email: string): StoredUser | undefined {
    this.reloadIfChanged();
    return this.users.get(email.trim().toLowerCase());
  }

  private reloadIfChanged() {
    try {
      const mtimeMs = fs.statSync(this.cfg.usersFile).mtimeMs;
      if (mtimeMs === this.loadedMtimeMs) return;
      // Record the attempt first, so a broken file is reported once, not on every request.
      this.loadedMtimeMs = mtimeMs;
      this.load({ throwOnError: false });
    } catch (err) {
      this.logger.error(`Users file ${this.cfg.usersFile} is unreadable; keeping the last loaded list: ${(err as Error).message}`);
    }
  }

  private load({ throwOnError }: { throwOnError: boolean }) {
    const file = this.cfg.usersFile;
    try {
      const mtimeMs = fs.statSync(file).mtimeMs;
      const parsed = usersFileSchema.safeParse(JSON.parse(fs.readFileSync(file, 'utf8')));
      if (!parsed.success) {
        const why = parsed.error.issues.map((i) => `[${i.path.join('.')}] ${i.message}`).join('; ');
        throw new Error(`Invalid users file ${file}: ${why}`);
      }
      const users = new Map(parsed.data.map((u) => [u.email, u]));
      if (users.size !== parsed.data.length) throw new Error(`Users file ${file} lists the same email more than once.`);

      this.users = users;
      this.loadedMtimeMs = mtimeMs;
      const allowed = parsed.data.filter((u) => this.cfg.allowedRoles.includes(u.role)).length;
      this.logger.log(
        `Loaded ${users.size} users from ${file} (${allowed} with dashboard access; allowed roles: ${this.cfg.allowedRoles.join(', ')})`,
      );
    } catch (err) {
      if (throwOnError) throw err;
      this.logger.error(`Could not reload users; keeping the last loaded list: ${(err as Error).message}`);
    }
  }
}
