const YJS_UPDATE_MESSAGE_TYPE = 2;

export function assertSyncAllowedForAccess(input: {
  connection: {
    readOnly: boolean;
  };
  type: number;
}): void {
  if (input.connection.readOnly && input.type === YJS_UPDATE_MESSAGE_TYPE) {
    throw new Error("read_only_update_forbidden");
  }
}
