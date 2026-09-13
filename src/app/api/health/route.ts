import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    name: "LawLink",
    status: "ok",
    timestamp: new Date().toISOString()
  });
}
