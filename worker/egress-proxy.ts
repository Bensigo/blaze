import { createEgressGuard } from "./egress-guard";
const token = process.env.EGRESS_TOKEN || "";
const guard = createEgressGuard({ token });
guard.proxy.listen(3128, "0.0.0.0");
guard.control.listen(9090, "0.0.0.0");
