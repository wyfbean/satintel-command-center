import { seededIntelRecords } from "@/lib/mock/articles";
import type { SourceAdapter } from "@/lib/intel/adapters/base";
import type { IntelSource, RawIntelRecord } from "@/types/intel";

export class MockAdapter implements SourceAdapter {
  kind: IntelSource["kind"] = "mock";

  async collect(source: IntelSource): Promise<RawIntelRecord[]> {
    return seededIntelRecords.filter((item) => item.sourceId === source.id);
  }
}
