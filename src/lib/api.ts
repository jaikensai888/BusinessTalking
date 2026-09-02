import { NextResponse } from "next/server";

/** 统一成功响应：{ code: 0, message, data, timestamp } */
export function ok(data: unknown, message = "success") {
  return NextResponse.json({
    code: 0,
    message,
    data,
    timestamp: new Date().toISOString(),
  });
}

/** 统一错误响应；httpStatus 默认按 code 映射 */
const STATUS_BY_CODE: Record<number, number> = {
  40001: 400,
  40401: 404,
  40901: 409,
  42201: 422,
  50001: 500,
  50002: 500,
  50201: 502,
  50401: 504,
};

export function err(code: number, message: string, httpStatus?: number) {
  return NextResponse.json(
    {
      code,
      message,
      data: null,
      timestamp: new Date().toISOString(),
    },
    { status: httpStatus ?? STATUS_BY_CODE[code] ?? 500 }
  );
}
