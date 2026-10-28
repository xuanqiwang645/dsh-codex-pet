/** Model picker data comes from the signed-in local Codex catalog. */
import type { CodexModelCatalog } from '../codex/index.ts';
import type { RegisteredRoute } from '../standalone/context.ts';

export function createCodexModelsRoute(readModels: () => Promise<CodexModelCatalog>): RegisteredRoute {
  return {
    kind: 'exact',
    path: '/companion/models',
    async handler(req, res) {
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.setHeader('cache-control', 'no-store');
      if (req.method !== 'GET') {
        res.writeHead(405);
        res.end(JSON.stringify({ ok: false, message: '仅支持 GET' }));
        return;
      }
      try {
        const snapshot = await readModels();
        res.writeHead(200);
        res.end(
          JSON.stringify({
            ok: true,
            connected: snapshot.connected,
            configuredModel: snapshot.configuredModel,
            effectiveModel: snapshot.effectiveModel,
            models: snapshot.models.map(({ id, name, isDefault }) => ({ id, name, isDefault })),
          }),
        );
      } catch {
        res.writeHead(503);
        res.end(JSON.stringify({ ok: false, message: '暂时无法读取 Codex 模型列表，请检查本机 Codex 登录后重试。' }));
      }
    },
  };
}
