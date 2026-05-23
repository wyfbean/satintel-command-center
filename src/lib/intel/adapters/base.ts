import type { IntelSource, RawIntelRecord } from "@/types/intel";

export interface SourceAdapter {
  kind: IntelSource["kind"];
  collect(source: IntelSource): Promise<RawIntelRecord[]>;
}
