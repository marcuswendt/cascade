export interface PackageInfo {
  name: string;
  version: string;
  description?: string;
  keywords?: string[];
  author?: {
    name: string;
    email?: string;
  };
  homepage?: string;
  repository?: {
    url: string;
  };
}

export interface SearchResult {
  package: PackageInfo;
  score: {
    final: number;
    detail: {
      quality: number;
      popularity: number;
      maintenance: number;
    };
  };
  searchScore: number;
}

export class PackageManager {
  private cache = new Map<string, any>();
  private loadingPromises = new Map<string, Promise<any>>();
  private cdnBaseUrl = 'https://esm.sh';

  /**
   * Load an NPM package from CDN
   * @param packageName Package name (e.g., 'three', 'lodash', '@tensorflow/tfjs')
   * @param version Optional version (defaults to 'latest')
   * @returns The loaded module
   */
  async load(packageName: string, version: string = 'latest'): Promise<any> {
    const key = `${packageName}@${version}`;

    // Check cache first
    if (this.cache.has(key)) {
      return this.cache.get(key);
    }

    // If already loading, return the existing promise
    if (this.loadingPromises.has(key)) {
      return this.loadingPromises.get(key)!;
    }

    // Start loading
    const loadPromise = this.loadPackage(key, packageName, version);
    this.loadingPromises.set(key, loadPromise);

    try {
      const module = await loadPromise;
      this.cache.set(key, module);
      return module;
    } catch (error) {
      this.loadingPromises.delete(key);
      throw error;
    }
  }

  private async loadPackage(key: string, packageName: string, version: string): Promise<any> {
    // Construct CDN URL
    // esm.sh format: https://esm.sh/package@version
    const versionPart = version === 'latest' ? '' : `@${version}`;
    const url = `${this.cdnBaseUrl}/${packageName}${versionPart}`;

    try {
      // Use dynamic import to load the module
      const module = await import(/* @vite-ignore */ url);
      
      // Handle different export formats
      // Some packages export as default, others as named exports
      if (module.default && typeof module.default === 'object') {
        return module.default;
      }
      
      // If module has a default export that's a function/class, return it
      if (module.default !== undefined) {
        return module.default;
      }
      
      // Otherwise return the whole module
      return module;
    } catch (error: any) {
      throw new Error(
        `Failed to load package ${key}: ${error.message || 'Unknown error'}\n` +
        `URL: ${url}`
      );
    }
  }

  /**
   * Search for packages in the NPM registry
   * @param query Search query
   * @param limit Maximum number of results (default: 20)
   * @returns Array of package search results
   */
  async search(query: string, limit: number = 20): Promise<PackageInfo[]> {
    try {
      // Use CORS proxy or direct API call
      // npm registry supports CORS, but we'll handle errors gracefully
      const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=${limit}`;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json'
        }
      });
      
      if (!response.ok) {
        // If CORS fails, try alternative approach or return empty results
        if (response.status === 0 || response.status === 403 || response.status === 404) {
          console.warn('NPM registry search may be blocked by CORS. Using fallback.');
          return [];
        }
        throw new Error(`Search failed: ${response.statusText}`);
      }

      const data = await response.json();
      
      // Extract package info from search results
      return data.objects?.map((result: SearchResult) => ({
        name: result.package.name,
        version: result.package.version,
        description: result.package.description,
        keywords: result.package.keywords || [],
        author: result.package.author,
        homepage: result.package.links?.homepage,
        repository: result.package.links?.repository
          ? { url: result.package.links.repository }
          : undefined
      })) || [];
    } catch (error: any) {
      // If it's a CORS or network error, return empty array instead of throwing
      if (error.message?.includes('CORS') || error.message?.includes('Failed to fetch')) {
        console.warn('NPM registry search unavailable:', error.message);
        return [];
      }
      throw new Error(`Failed to search packages: ${error.message || 'Unknown error'}`);
    }
  }

  /**
   * Get package information from NPM registry
   * @param packageName Package name
   * @returns Package metadata
   */
  async getPackageInfo(packageName: string): Promise<PackageInfo | null> {
    try {
      const url = `https://registry.npmjs.org/${encodeURIComponent(packageName)}`;
      const response = await fetch(url);
      
      if (!response.ok) {
        if (response.status === 404) {
          return null;
        }
        throw new Error(`Failed to fetch package info: ${response.statusText}`);
      }

      const data = await response.json();
      const latestVersion = data['dist-tags']?.latest || Object.keys(data.versions).pop();
      const versionData = data.versions[latestVersion];

      return {
        name: data.name,
        version: latestVersion,
        description: versionData.description,
        keywords: versionData.keywords || [],
        author: versionData.author,
        homepage: data.homepage || versionData.homepage,
        repository: versionData.repository
      };
    } catch (error: any) {
      throw new Error(`Failed to get package info: ${error.message || 'Unknown error'}`);
    }
  }

  /**
   * Clear the package cache
   */
  clearCache() {
    this.cache.clear();
    this.loadingPromises.clear();
  }

  /**
   * Remove a specific package from cache
   */
  removeFromCache(packageName: string, version?: string) {
    if (version) {
      const key = `${packageName}@${version}`;
      this.cache.delete(key);
      this.loadingPromises.delete(key);
    } else {
      // Remove all versions of this package
      for (const key of this.cache.keys()) {
        if (key.startsWith(`${packageName}@`)) {
          this.cache.delete(key);
          this.loadingPromises.delete(key);
        }
      }
    }
  }

  /**
   * Get list of cached packages
   */
  getCachedPackages(): string[] {
    return Array.from(this.cache.keys());
  }
}

