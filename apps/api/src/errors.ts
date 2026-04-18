export interface ApiErrorResponse {
  error:
    | "bad_request"
    | "forbidden"
    | "internal_error"
    | "not_found"
    | "unauthenticated"
    | "unsupported_media_type";
  statusCode: number;
}

export function buildApiErrorResponse(
  error: unknown,
  replyStatusCode: number
): ApiErrorResponse {
  const errorStatusCode =
    typeof (error as { statusCode?: unknown }).statusCode === "number"
      ? (error as { statusCode: number }).statusCode
      : undefined;
  const statusCode =
    errorStatusCode !== undefined &&
    errorStatusCode >= 400 &&
    errorStatusCode < 600
      ? errorStatusCode
      : replyStatusCode >= 400
        ? replyStatusCode
        : 500;

  if (
    error instanceof Error &&
    (error as Error & { code?: string }).code === "FST_ERR_CTP_INVALID_MEDIA_TYPE"
  ) {
    return {
      error: "unsupported_media_type",
      statusCode: 415
    };
  }

  if (statusCode >= 400 && statusCode < 500) {
    const errorCode =
      statusCode === 401
        ? "unauthenticated"
        : statusCode === 403
          ? "forbidden"
          : statusCode === 404
            ? "not_found"
            : "bad_request";

    return {
      error: errorCode,
      statusCode
    };
  }

  return {
    error: "internal_error",
    statusCode: 500
  };
}
