import { describe, it, expect } from "vitest";
import { signRequestV4 } from "./sigv4";

// Vecteur officiel AWS (documentation S3 « Signature Calculations for the
// Authorization Header » — exemple GET Object avec en-tête Range).
describe("signRequestV4", () => {
  const credentials = {
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  };

  it("reproduit la signature de référence AWS", () => {
    const headers = signRequestV4(
      {
        method: "GET",
        url: "https://examplebucket.s3.amazonaws.com/test.txt",
        headers: { Range: "bytes=0-9" },
        region: "us-east-1",
        service: "s3",
        now: new Date("2013-05-24T00:00:00Z"),
      },
      credentials,
    );
    expect(headers.authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, " +
        "SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, " +
        "Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
    );
  });

  it("signe le hash du corps pour un PUT", () => {
    const headers = signRequestV4(
      {
        method: "PUT",
        url: "https://x.r2.cloudflarestorage.com/bucket/org/a b.png",
        body: Buffer.from("abc"),
        region: "auto",
        service: "s3",
        now: new Date("2026-10-07T10:00:00Z"),
      },
      credentials,
    );
    expect(headers["x-amz-content-sha256"]).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(headers["x-amz-date"]).toBe("20261007T100000Z");
  });
});
