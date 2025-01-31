export type DateRange = { start: Date; end: Date };
export type ReportOptions = { week?: boolean; yesterday?: boolean };

export class ReportConfig {
  constructor(
    public readonly name: string,
    public readonly predicate: (opts: ReportOptions) => boolean,
    public readonly getRange: (now: Date) => DateRange,
    public readonly formatTitle: (now: Date) => string
  ) {}

  static builder() {
    return new ReportConfigBuilder();
  }
}

class ReportConfigBuilder {
  private nameValue?: string;
  private predicateValue?: (opts: ReportOptions) => boolean;
  private getRangeValue?: (now: Date) => DateRange;
  private formatTitleValue?: (now: Date) => string;

  name(name: string): this {
    this.nameValue = name;
    return this;
  }

  when(predicate: (opts: ReportOptions) => boolean): this {
    this.predicateValue = predicate;
    return this;
  }

  dateRange(getRange: (now: Date) => DateRange): this {
    this.getRangeValue = getRange;
    return this;
  }

  title(formatTitle: (now: Date) => string): this {
    this.formatTitleValue = formatTitle;
    return this;
  }

  build(): ReportConfig {
    if (!this.nameValue) throw new Error('Report config requires name');
    if (!this.getRangeValue) throw new Error('Report config requires date range');
    if (!this.formatTitleValue) throw new Error('Report config requires title formatter');
    return new ReportConfig(
      this.nameValue,
      this.predicateValue || (() => false),
      this.getRangeValue!,
      this.formatTitleValue!
    );
  }
}