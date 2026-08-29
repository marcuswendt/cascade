export interface ProjectManifestDto {
  name: string;
  commands: Record<string, string>;
  credentials: string[];
  settings: Record<string, unknown>;
}

export interface ProjectSettingsDto {
  ok: true;
  manifest: ProjectManifestDto;
  requiredCredentials: Array<{ name: string; set: boolean }>;
  missingCredentials: string[];
}

let capability: Promise<string> | null = null;

export async function loadProjectSettings(): Promise<ProjectSettingsDto> {
  return request('GET');
}

export async function saveProjectSettings(manifest: ProjectManifestDto): Promise<ProjectSettingsDto> {
  return request('PUT', manifest);
}

async function request(method: 'GET' | 'PUT', body?: ProjectManifestDto): Promise<ProjectSettingsDto> {
  capability ??= fetch('/api/project/capability').then(async (response) => {
    if (!response.ok) throw new Error(`Project settings are unavailable (HTTP ${response.status})`);
    return (await response.json()).capability as string;
  });
  const response = await fetch('/api/project', {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Cascade-Project-Capability': await capability },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? `Project settings failed (HTTP ${response.status})`);
  return value as ProjectSettingsDto;
}
