export class ModulePathManager<T> {
    private modules: Map<string, T> = new Map();

    public set(prefix: string, config: T) {
        console.log(`Setting ${prefix} to ${config}`);
        this.modules.set(prefix, config);
    }

    public get(prefix: string) {
        return this.modules.get(prefix);
    }

    public delete(prefix: string) {
        this.modules.delete(prefix);
    }

    public search(path: string): ({ path: string, module: T } | null) {
        const config = [...this.modules.entries()]
            .filter(([k]) => path.startsWith(k))
            .sort(([k1], [k2]) => k2.length - k1.length);

        return config.length > 0 ? {
            path: config[0][0],
            module: config[0][1],
        } : null;
    }
}