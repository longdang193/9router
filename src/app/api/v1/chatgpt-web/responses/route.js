export const dynamic = "force-dynamic";

import { RetiredModelError, retiredModelPayload } from "../../../../../../open-sse/config/retiredModels.js";

function retiredResponse() {
  const error = new RetiredModelError("chatgpt-web");
  return Response.json(retiredModelPayload(error), { status: error.status });
}

export function GET() {
  return retiredResponse();
}

export function POST() {
  return retiredResponse();
}

export function OPTIONS() {
  return retiredResponse();
}
