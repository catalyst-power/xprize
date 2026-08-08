/**
 * POST /api/inference/capture
 *
 * Server-side capture gateway for the AgriFortress AI-native delivery gesture.
 * Accepts a voice-note or photo from the browser (multipart), forwards it to
 * the kernel inference engine with app-auth (fetchKernel) and
 * vocabulary=agrifortress, and returns the ranked candidateIntents.
 *
 * Never calls the kernel from the browser — see AGENTS.md §2.
 *
 * Request body (multipart/form-data):
 *   file      Blob / File  required  Voice recording or photo
 *   filename  string       optional  Human-readable file name
 *
 * Responses:
 *   401  No active session
 *   400  file field missing or not a File/Blob
 *   200  InferenceCaptureResponse from the kernel
 *   502  Kernel call failed
 *
 * Issue: catalyst-power/xprize#5
 */

import { NextResponse, type NextRequest } from 'next/server';
import { getSession } from '@/lib/session';
import { captureInference } from '@/lib/inference';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  // Session guard — kernel calls must be on behalf of an authenticated user.
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Expected multipart form data' }, { status: 400 });
  }

  const fileEntry = formData.get('file');
  if (!(fileEntry instanceof File)) {
    return NextResponse.json({ error: 'file (audio or image) is required' }, { status: 400 });
  }

  const filenameEntry = formData.get('filename');
  const filename = typeof filenameEntry === 'string' ? filenameEntry : undefined;

  try {
    const result = await captureInference(fileEntry, user.attestationId, filename);
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
