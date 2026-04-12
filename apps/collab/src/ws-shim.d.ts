declare module "ws" {
  type WebSocket = object;
  export default WebSocket;

  export class WebSocketServer {
    constructor(options: { noServer: boolean });
    handleUpgrade(
      request: unknown,
      socket: unknown,
      head: unknown,
      callback: (websocket: WebSocket) => void
    ): void;
  }
}
