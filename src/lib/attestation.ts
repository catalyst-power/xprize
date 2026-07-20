const REGISTRY_URL = process.env.IMAJIN_REGISTRY_URL || 'https://registry.imajin.ai';
const APP_DID = process.env.IMAJIN_APP_DID;

export interface DeliveryAttestation {
  deliveryId: string;
  supplierDid: string;
  buyerDid: string;
  items: Array<{ description: string; quantity: number; unit: string }>;
  deliveredAt: string;
}

export async function createDeliveryAttestation(
  issuerDid: string,
  subjectDid: string,
  delivery: DeliveryAttestation,
  appDid?: string,
): Promise<{ attestationId: string } | null> {
  try {
    const res = await fetch(`${REGISTRY_URL}/api/attestations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(appDid ? { 'X-App-DID': appDid } : {}),
      },
      body: JSON.stringify({
        type: 'delivery.completed',
        issuer: issuerDid,
        subject: subjectDid,
        payload: delivery,
      }),
    });
    if (!res.ok) {
      console.error('Attestation creation failed:', res.status, await res.text());
      return null;
    }
    return (await res.json()) as { attestationId: string };
  } catch (err) {
    console.error('Attestation error:', err);
    return null;
  }
}

// Convenience wrapper that uses the app DID from env
export async function createDeliveryAttestationWithEnvDid(
  issuerDid: string,
  subjectDid: string,
  delivery: DeliveryAttestation,
): Promise<{ attestationId: string } | null> {
  return createDeliveryAttestation(issuerDid, subjectDid, delivery, APP_DID);
}
