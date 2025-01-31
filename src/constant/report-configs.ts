import { startOfDay, startOfWeek, subDays } from "date-fns";
import { ReportConfig } from "../types/report-config.js";
import { Titles } from "../util/date-titles.util.js";

export const reportConfigs = [
    ReportConfig.builder()
      .name('week')
      .when(opts => !!opts.week)
      .dateRange(now => ({
        start: startOfWeek(now, { weekStartsOn: 1 }),
        end: now
      }))
      .title(Titles.weeklyTitle)
      .build(),

    ReportConfig.builder()
      .name('yesterday')
      .when(opts => !!opts.yesterday)
      .dateRange(now => ({
        start: startOfDay(subDays(now, 1)),
        end: now
      }))
      .title(Titles.yesterdayTitle)
      .build(),

    ReportConfig.builder()
        .name('today')
        .when(() => true)
        .dateRange(now => ({
        start: startOfDay(now),
        end: now
        }))
        .title(Titles.dailyTitle)
        .build(),
  
  ];