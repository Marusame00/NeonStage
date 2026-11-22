import type { DataSourceRequest } from '../../widgets/contract';
import type { ProjectDoc } from '../../shared/model';
import { getWidget } from '../../widgets/registry';
import type { ProviderManager } from '../providers/manager';

export class WidgetRuntimeHost {
  private readonly releases = new Map<string, () => void>();

  constructor(private readonly manager: ProviderManager) {}

  sync(docs: ProjectDoc[]): void {
    const wanted = new Map<string, DataSourceRequest>();
    for (const doc of docs) {
      for (const scene of doc.scenes) {
        for (const node of Object.values(scene.nodes)) {
          if (!node.widget) continue;
          const definition = getWidget(node.widget.kind);
          if (!definition?.dataSources) continue;
          const props = definition.validate(node.widget.props);
          for (const request of definition.dataSources(props)) {
            if (!wanted.has(request.key)) wanted.set(request.key, request);
          }
        }
      }
    }

    for (const [key, release] of [...this.releases]) {
      if (wanted.has(key)) continue;
      release();
      this.releases.delete(key);
    }

    for (const [key, request] of wanted) {
      if (this.releases.has(key)) continue;
      this.releases.set(key, this.manager.acquire(request));
    }
  }

  dispose(): void {
    for (const release of this.releases.values()) release();
    this.releases.clear();
  }

  activeKeys(): string[] {
    return [...this.releases.keys()];
  }
}
