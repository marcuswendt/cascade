# Cascade Cloud: Online Project Storage (Phase 2)

## Overview

Add cloud storage to Cascade, enabling users to save projects online, access them from anywhere, and eventually share with others. Builds on top of the local mode storage adapter architecture.

**Prerequisites:** Phase 1 (Local Mode) complete - StorageAdapter interface exists.

**Goal:** Users can sign in and save/load projects from cascade.field.io while the same editor works both locally and in the cloud.

---

## Architecture

### Dual-Mode Storage

The editor uses the same `StorageAdapter` interface for both modes:

```typescript
// Mode selection based on environment
export function createStorageAdapter(projectSlug?: string): StorageAdapter {
  if (window.__CASCADE_LOCAL__) {
    // Electron app - use filesystem
    return new LocalStorageAdapter(currentProjectPath);
  } else {
    // Web app - use cloud API
    return new CloudStorageAdapter(currentUser.username, projectSlug);
  }
}
```

### Cloud Storage Adapter

```typescript
// src/lib/storage/cloud-adapter.ts
export class CloudStorageAdapter implements StorageAdapter {
  private baseUrl = '/api';
  
  constructor(
    private username: string,
    private projectSlug: string
  ) {}
  
  get projectRoot(): string {
    return `${this.username}/${this.projectSlug}`;
  }
  
  async getProject(): Promise<Project> {
    const res = await fetch(`${this.baseUrl}/projects/${this.projectSlug}`);
    if (!res.ok) throw new Error('Failed to load project');
    return res.json();
  }
  
  async updateProject(data: Partial<Project>): Promise<Project> {
    const res = await fetch(`${this.baseUrl}/projects/${this.projectSlug}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.json();
  }
  
  async listGraphs(): Promise<Graph[]> {
    const res = await fetch(`${this.baseUrl}/projects/${this.projectSlug}/graphs`);
    return res.json();
  }
  
  async getGraph(slug: string): Promise<Graph | null> {
    const res = await fetch(`${this.baseUrl}/projects/${this.projectSlug}/graphs/${slug}`);
    if (res.status === 404) return null;
    return res.json();
  }
  
  async saveGraph(slug: string, content: GraphContent): Promise<Graph> {
    const res = await fetch(`${this.baseUrl}/projects/${this.projectSlug}/graphs/${slug}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    return res.json();
  }
  
  async createGraph(name: string): Promise<Graph> {
    const res = await fetch(`${this.baseUrl}/projects/${this.projectSlug}/graphs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    return res.json();
  }
  
  async deleteGraph(slug: string): Promise<void> {
    await fetch(`${this.baseUrl}/projects/${this.projectSlug}/graphs/${slug}`, {
      method: 'DELETE',
    });
  }
  
  async renameGraph(slug: string, newName: string): Promise<Graph> {
    const res = await fetch(`${this.baseUrl}/projects/${this.projectSlug}/graphs/${slug}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName }),
    });
    return res.json();
  }
  
  async listAssets(): Promise<Asset[]> {
    const res = await fetch(`${this.baseUrl}/projects/${this.projectSlug}/assets`);
    return res.json();
  }
  
  getAssetUrl(assetPath: string): string {
    return `https://assets.cascade.field.io/${this.username}/${this.projectSlug}/${assetPath}`;
  }
  
  async importAsset(file: File, targetPath?: string): Promise<Asset> {
    const filename = targetPath || file.name;
    
    // Get signed upload URL
    const urlRes = await fetch(`${this.baseUrl}/projects/${this.projectSlug}/assets/upload-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename,
        contentType: file.type,
        sizeBytes: file.size,
      }),
    });
    
    const { uploadUrl, assetUrl } = await urlRes.json();
    
    // Upload directly to R2
    await fetch(uploadUrl, {
      method: 'PUT',
      body: file,
      headers: { 'Content-Type': file.type },
    });
    
    // Confirm upload
    const confirmRes = await fetch(`${this.baseUrl}/projects/${this.projectSlug}/assets/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: `assets/${filename}`,
        sizeBytes: file.size,
        mimeType: file.type,
      }),
    });
    
    return confirmRes.json();
  }
  
  async deleteAsset(assetPath: string): Promise<void> {
    await fetch(`${this.baseUrl}/projects/${this.projectSlug}/assets/${encodeURIComponent(assetPath)}`, {
      method: 'DELETE',
    });
  }
}
```

### Cloud Project Manager

Additional API for managing multiple projects (cloud-only):

```typescript
// src/lib/storage/cloud-manager.ts
export class CloudProjectManager {
  private baseUrl = '/api';
  
  async listProjects(): Promise<ProjectSummary[]> {
    const res = await fetch(`${this.baseUrl}/projects`);
    return res.json();
  }
  
  async createProject(data: { name: string; description?: string }): Promise<Project> {
    const res = await fetch(`${this.baseUrl}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.json();
  }
  
  async deleteProject(slug: string): Promise<void> {
    await fetch(`${this.baseUrl}/projects/${slug}`, { method: 'DELETE' });
  }
  
  async getRecentGraphs(limit = 10): Promise<RecentGraph[]> {
    const res = await fetch(`${this.baseUrl}/dashboard/recent?limit=${limit}`);
    return res.json();
  }
  
  openProject(slug: string): CloudStorageAdapter {
    return new CloudStorageAdapter(getCurrentUser().username, slug);
  }
}
```

---

## Tech Stack

### Backend

- **Framework**: SvelteKit API routes
- **Database**: Vercel Postgres
- **ORM**: Drizzle
- **Auth**: Lucia Auth v3
- **File Storage**: Cloudflare R2

### Deployment

- **Platform**: Vercel
- **Domain**: cascade.field.io
- **Assets CDN**: assets.cascade.field.io (R2)

---

## Database Schema

```typescript
// src/lib/server/db/schema.ts
import { pgTable, text, timestamp, uuid, boolean, integer, index, uniqueIndex } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  username: text('username').notNull().unique(),
  name: text('name').notNull(),
  avatarUrl: text('avatar_url'),
  googleId: text('google_id').unique(),
  passwordHash: text('password_hash'),
  storageUsedBytes: integer('storage_used_bytes').default(0).notNull(),
  storageLimit: integer('storage_limit').default(1073741824).notNull(), // 1GB
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at').notNull(),
});

export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  slug: text('slug').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  isPublic: boolean('is_public').default(false).notNull(),
  deletedAt: timestamp('deleted_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  userSlugIdx: uniqueIndex('user_slug_idx').on(table.userId, table.slug),
}));

export const graphs = pgTable('graphs', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  slug: text('slug').notNull(),
  name: text('name').notNull(),
  currentVersionId: uuid('current_version_id'),
  deletedAt: timestamp('deleted_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  projectSlugIdx: uniqueIndex('project_slug_idx').on(table.projectId, table.slug),
}));

// Content-addressable storage for graph content
export const graphContents = pgTable('graph_contents', {
  id: uuid('id').primaryKey().defaultRandom(),
  hash: text('hash').notNull().unique(),
  content: text('content').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Unlimited version history
export const graphVersions = pgTable('graph_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  graphId: uuid('graph_id').notNull().references(() => graphs.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),
  contentHash: text('content_hash').notNull(),
  contentId: uuid('content_id').notNull().references(() => graphContents.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  graphVersionIdx: index('graph_version_idx').on(table.graphId, table.version),
}));

export const assets = pgTable('assets', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  filename: text('filename').notNull(),
  path: text('path').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
```

---

## API Routes

### Authentication

```
POST   /api/auth/register           # Create account
POST   /api/auth/login              # Email/password login
POST   /api/auth/logout             # End session
GET    /api/auth/me                 # Current user
GET    /api/auth/google             # Google OAuth start
GET    /api/auth/google/callback    # Google OAuth callback
POST   /api/auth/username           # Set username
GET    /api/auth/username/check     # Check availability
```

### Projects

```
GET    /api/projects                # List user's projects
POST   /api/projects                # Create project
GET    /api/projects/:slug          # Get project
PATCH  /api/projects/:slug          # Update project
DELETE /api/projects/:slug          # Delete project
```

### Graphs

```
GET    /api/projects/:slug/graphs              # List graphs
POST   /api/projects/:slug/graphs              # Create graph
GET    /api/projects/:slug/graphs/:graphSlug   # Get graph
PUT    /api/projects/:slug/graphs/:graphSlug   # Save graph
PATCH  /api/projects/:slug/graphs/:graphSlug   # Update metadata
DELETE /api/projects/:slug/graphs/:graphSlug   # Delete graph

GET    /api/projects/:slug/graphs/:graphSlug/versions            # Version history
GET    /api/projects/:slug/graphs/:graphSlug/versions/:version   # Get version
POST   /api/projects/:slug/graphs/:graphSlug/versions/:version/restore
```

### Assets

```
GET    /api/projects/:slug/assets              # List assets
POST   /api/projects/:slug/assets/upload-url   # Get signed upload URL
POST   /api/projects/:slug/assets/confirm      # Confirm upload
DELETE /api/projects/:slug/assets/:path        # Delete asset
```

### Dashboard

```
GET    /api/dashboard/recent        # Recent graphs across projects
GET    /api/dashboard/stats         # Storage usage, project count
```

---

## SvelteKit Routes Structure

```
src/routes/
├── +layout.svelte                  # Root layout
├── +layout.server.ts               # Auth check
├── +page.svelte                    # Landing / redirect
│
├── login/
│   └── +page.svelte                # Login page
│
├── register/
│   └── +page.svelte                # Register page
│
├── dashboard/
│   ├── +page.svelte                # Dashboard
│   └── +page.server.ts             # Load recent projects/graphs
│
├── [username]/
│   └── [project]/
│       ├── +page.svelte            # Project view (list graphs)
│       ├── +page.server.ts         # Load project
│       └── [graph]/
│           ├── +page.svelte        # Editor
│           └── +page.server.ts     # Load graph
│
├── settings/
│   └── +page.svelte                # User settings
│
└── api/
    ├── auth/
    │   ├── register/+server.ts
    │   ├── login/+server.ts
    │   ├── logout/+server.ts
    │   ├── me/+server.ts
    │   ├── google/+server.ts
    │   ├── google/callback/+server.ts
    │   └── username/
    │       ├── +server.ts
    │       └── check/+server.ts
    │
    ├── projects/
    │   ├── +server.ts              # List/create projects
    │   └── [slug]/
    │       ├── +server.ts          # Get/update/delete project
    │       ├── graphs/
    │       │   ├── +server.ts      # List/create graphs
    │       │   └── [graphSlug]/
    │       │       ├── +server.ts  # Get/save/delete graph
    │       │       └── versions/
    │       │           └── ...
    │       └── assets/
    │           ├── +server.ts
    │           ├── upload-url/+server.ts
    │           └── confirm/+server.ts
    │
    └── dashboard/
        ├── recent/+server.ts
        └── stats/+server.ts
```

---

## Authentication (Lucia)

### Setup

```typescript
// src/lib/server/auth.ts
import { Lucia } from 'lucia';
import { DrizzlePostgreSQLAdapter } from '@lucia-auth/adapter-drizzle';
import { Google } from 'arctic';
import { db } from './db';
import { users, sessions } from './db/schema';

const adapter = new DrizzlePostgreSQLAdapter(db, sessions, users);

export const lucia = new Lucia(adapter, {
  sessionCookie: {
    attributes: {
      secure: process.env.NODE_ENV === 'production',
    },
  },
  getUserAttributes: (attributes) => ({
    email: attributes.email,
    username: attributes.username,
    name: attributes.name,
    avatarUrl: attributes.avatarUrl,
  }),
});

export const google = new Google(
  process.env.GOOGLE_CLIENT_ID!,
  process.env.GOOGLE_CLIENT_SECRET!,
  process.env.GOOGLE_REDIRECT_URI!
);

declare module 'lucia' {
  interface Register {
    Lucia: typeof lucia;
    DatabaseUserAttributes: {
      email: string;
      username: string;
      name: string;
      avatarUrl: string | null;
    };
  }
}
```

### Auth Hook

```typescript
// src/hooks.server.ts
import type { Handle } from '@sveltejs/kit';
import { lucia } from '$lib/server/auth';

export const handle: Handle = async ({ event, resolve }) => {
  const sessionId = event.cookies.get(lucia.sessionCookieName);
  
  if (!sessionId) {
    event.locals.user = null;
    event.locals.session = null;
    return resolve(event);
  }
  
  const { session, user } = await lucia.validateSession(sessionId);
  
  if (session?.fresh) {
    const sessionCookie = lucia.createSessionCookie(session.id);
    event.cookies.set(sessionCookie.name, sessionCookie.value, {
      path: '.',
      ...sessionCookie.attributes,
    });
  }
  
  if (!session) {
    const sessionCookie = lucia.createBlankSessionCookie();
    event.cookies.set(sessionCookie.name, sessionCookie.value, {
      path: '.',
      ...sessionCookie.attributes,
    });
  }
  
  event.locals.user = user;
  event.locals.session = session;
  
  return resolve(event);
};
```

---

## Cloudflare R2 Setup

```typescript
// src/lib/server/storage.ts
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const R2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.CF_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

const BUCKET = 'cascade-assets';

export async function getSignedUploadUrl(
  userId: string,
  projectId: string,
  filename: string,
  contentType: string
): Promise<string> {
  const key = `${userId}/${projectId}/assets/${filename}`;
  
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: contentType,
  });
  
  return getSignedUrl(R2, command, { expiresIn: 3600 });
}

export async function deleteAsset(
  userId: string,
  projectId: string,
  assetPath: string
): Promise<void> {
  const key = `${userId}/${projectId}/${assetPath}`;
  
  await R2.send(new DeleteObjectCommand({
    Bucket: BUCKET,
    Key: key,
  }));
}
```

---

## Asset Validation

```typescript
// src/lib/server/assets.ts
const LIMITS = {
  video: {
    maxBytes: 100 * 1024 * 1024, // 100MB
    mimeTypes: ['video/mp4', 'video/webm', 'video/quicktime'],
  },
  default: {
    maxBytes: 50 * 1024 * 1024, // 50MB
  },
  userStorage: 1024 * 1024 * 1024, // 1GB
};

const ALLOWED_TYPES = [
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml',
  'video/mp4', 'video/webm', 'video/quicktime',
  'audio/mpeg', 'audio/wav', 'audio/ogg',
  'font/woff', 'font/woff2', 'font/ttf', 'font/otf',
  'application/json', 'text/plain', 'text/csv',
  'model/gltf-binary', 'model/gltf+json',
];

export function validateUpload(
  mimeType: string,
  sizeBytes: number,
  userStorageUsed: number
): { valid: boolean; error?: string } {
  if (!ALLOWED_TYPES.includes(mimeType)) {
    return { valid: false, error: `File type not allowed: ${mimeType}` };
  }
  
  const isVideo = LIMITS.video.mimeTypes.includes(mimeType);
  const maxBytes = isVideo ? LIMITS.video.maxBytes : LIMITS.default.maxBytes;
  
  if (sizeBytes > maxBytes) {
    return { valid: false, error: `File too large (max ${maxBytes / 1024 / 1024}MB)` };
  }
  
  if (userStorageUsed + sizeBytes > LIMITS.userStorage) {
    return { valid: false, error: 'Storage limit exceeded (1GB)' };
  }
  
  return { valid: true };
}
```

---

## Username Validation

```typescript
// src/lib/server/username.ts
const RESERVED = [
  'admin', 'api', 'app', 'auth', 'cascade', 'dashboard', 'help',
  'login', 'logout', 'register', 'settings', 'static', 'support',
  'www', 'new', 'edit', 'delete', 'assets', 'null', 'undefined',
];

export function validateUsername(username: string): { valid: boolean; error?: string } {
  if (username.length < 3) {
    return { valid: false, error: 'Username must be at least 3 characters' };
  }
  if (username.length > 30) {
    return { valid: false, error: 'Username must be 30 characters or less' };
  }
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(username)) {
    return { valid: false, error: 'Only lowercase letters, numbers, and hyphens allowed' };
  }
  if (username.includes('--')) {
    return { valid: false, error: 'No consecutive hyphens' };
  }
  if (RESERVED.includes(username)) {
    return { valid: false, error: 'Username not available' };
  }
  return { valid: true };
}
```

---

## Version History

```typescript
// src/lib/server/versions.ts
import crypto from 'crypto';

export async function saveGraphVersion(
  graphId: string,
  content: GraphContent
): Promise<{ version: number; hash: string }> {
  const json = JSON.stringify(content);
  const hash = crypto.createHash('sha256').update(json).digest('hex');
  const sizeBytes = Buffer.byteLength(json, 'utf8');
  
  return await db.transaction(async (tx) => {
    // Check for existing content (deduplication)
    let contentRecord = await tx.query.graphContents.findFirst({
      where: eq(graphContents.hash, hash),
    });
    
    if (!contentRecord) {
      [contentRecord] = await tx.insert(graphContents).values({
        hash,
        content: json,
        sizeBytes,
      }).returning();
    }
    
    // Get next version number
    const lastVersion = await tx.query.graphVersions.findFirst({
      where: eq(graphVersions.graphId, graphId),
      orderBy: desc(graphVersions.version),
    });
    
    const version = (lastVersion?.version ?? 0) + 1;
    
    // Create version
    await tx.insert(graphVersions).values({
      graphId,
      version,
      contentHash: hash,
      contentId: contentRecord.id,
    });
    
    // Update graph pointer
    await tx.update(graphs)
      .set({ currentVersionId: contentRecord.id, updatedAt: new Date() })
      .where(eq(graphs.id, graphId));
    
    return { version, hash };
  });
}
```

---

## URL Structure

```
# Dashboard
https://cascade.field.io/dashboard

# Project view
https://cascade.field.io/marcus/generative-patterns

# Editor (specific graph)
https://cascade.field.io/marcus/generative-patterns/particle-system

# Assets
https://assets.cascade.field.io/marcus/generative-patterns/assets/images/texture.png
```

---

## Implementation Phases

### Phase 2.1: SvelteKit Setup (2-3 days)

1. **Migrate to SvelteKit**
   - Initialize SvelteKit in existing project
   - Move editor to `$lib/editor/`
   - Setup adapter-vercel
   - Configure routes structure

2. **Database setup**
   - Create Vercel Postgres database
   - Configure Drizzle
   - Run migrations

### Phase 2.2: Authentication (3-4 days)

1. **Lucia Auth**
   - Session management
   - Google OAuth flow
   - Email/password (optional)

2. **Username system**
   - Username validation
   - Username selection on signup
   - Uniqueness checking

### Phase 2.3: Project/Graph API (3-4 days)

1. **Projects CRUD**
   - List/create/update/delete
   - Slug generation
   - Soft delete

2. **Graphs CRUD**
   - Save/load with versions
   - Content-addressable storage
   - Version history API

### Phase 2.4: Assets & Storage (2-3 days)

1. **R2 integration**
   - Signed URL uploads
   - Asset metadata tracking
   - Storage quota enforcement

2. **Asset validation**
   - File type checking
   - Size limits (100MB video, 50MB other)

### Phase 2.5: UI & Polish (2-3 days)

1. **Dashboard**
   - Recent projects/graphs list
   - New project dialog
   - Storage usage display

2. **Editor integration**
   - CloudStorageAdapter
   - Auto-save to cloud
   - Version history UI

### Phase 2.6: Deployment (1-2 days)

1. **Vercel setup**
   - Environment variables
   - Domain configuration
   - R2 public access

---

## Success Criteria

- [ ] User can sign up with Google
- [ ] User can choose username
- [ ] User can create/delete projects
- [ ] Graphs save to cloud with version history
- [ ] Assets upload to R2
- [ ] Storage quota enforced (1GB)
- [ ] Same editor works in cloud and local modes
- [ ] cascade.field.io deployed and working

---

## Environment Variables

```bash
# Vercel Postgres
POSTGRES_URL=
POSTGRES_PRISMA_URL=
POSTGRES_URL_NON_POOLING=

# Lucia Auth
AUTH_SECRET=

# Google OAuth
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=https://cascade.field.io/api/auth/google/callback

# Cloudflare R2
CF_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=

# App
PUBLIC_APP_URL=https://cascade.field.io
PUBLIC_ASSETS_URL=https://assets.cascade.field.io
```

---

## What's NOT in This Phase

- Project sharing / collaboration
- Public project URLs
- Team workspaces
- Real-time sync between users

These come in Phase 3 (Sharing & Collaboration).
