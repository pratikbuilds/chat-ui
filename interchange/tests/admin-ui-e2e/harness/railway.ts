import { createHubServer } from "@intx/hub-app/server";

import { createLocalProcessSidecarProvisioner } from "./local-process-sidecar-provisioner";

const dataDir = process.env["HUB_DATA_DIR"];
const sidecarKey = process.env["SIDECAR_CREDENTIAL_ENCRYPTION_KEY"];
if (!dataDir || !sidecarKey || !/^[0-9a-f]{64}$/i.test(sidecarKey)) {
  throw new Error(
    "HUB_DATA_DIR and a 32-byte SIDECAR_CREDENTIAL_ENCRYPTION_KEY are required",
  );
}

const local = createLocalProcessSidecarProvisioner({
  dataRoot: `${dataDir}/local-sidecars`,
  persistentData: true,
});

process.once("SIGTERM", () => {
  void local.shutdown().finally(() => process.exit(0));
});

export default await createHubServer({
  sidecarProvisioners: [local.provisioner],
  probeSidecarProvisioners: [local.provisioner],
});
