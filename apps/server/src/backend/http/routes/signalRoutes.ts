import type { SignalChannelService } from "../../channels/signal/service";

export function createSignalRoutes(signalService: SignalChannelService) {
  return {
    "/api/mockingbird/signal/status": {
      GET: async () => {
        return Response.json({
          status: signalService.getStatus(),
          pendingPairing: signalService.listPairingRequests().length,
          allowlist: signalService.listStoredAllowlist(),
        });
      },
    },
    "/api/mockingbird/signal/pairing": {
      GET: async () => {
        return Response.json({
          requests: signalService.listPairingRequests(),
        });
      },
    },
    "/api/mockingbird/signal/pairing/approve": {
      POST: async (req: Request) => {
        const body = (await req.json()) as { code?: string; senderId?: string };
        const entry = signalService.approvePairing({
          code: body.code,
          senderId: body.senderId,
        });
        if (!entry) {
          return Response.json({ error: "Pairing request not found" }, { status: 404 });
        }
        return Response.json({ approved: true, entry });
      },
    },
    "/api/mockingbird/signal/pairing/reject": {
      POST: async (req: Request) => {
        const body = (await req.json()) as { code?: string; senderId?: string };
        const rejected = signalService.rejectPairing({
          code: body.code,
          senderId: body.senderId,
        });
        if (!rejected) {
          return Response.json({ error: "Pairing request not found" }, { status: 404 });
        }
        return Response.json({ rejected: true });
      },
    },
  };
}
