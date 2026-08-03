import {
  DurableContext,
  withDurableExecution,
  createClassSerdesWithDates,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Class Serdes with Date rehydration",
  description:
    "Uses createClassSerdesWithDates to preserve both class methods and Date " +
    "objects across replay. JSON serialization turns Dates into ISO strings; " +
    "this serdes converts the configured (possibly nested) properties back into " +
    "Date instances on deserialize. Properties that are absent are left as-is.",
};

/**
 * An article whose timestamps must remain real Date objects after replay so
 * that date arithmetic (getAge) and Date methods keep working.
 *
 * NOTE: createClassSerdesWithDates requires a no-argument constructor — it calls
 * `new Article()` during deserialize, then Object.assigns the parsed JSON.
 */
class Article {
  title: string = "";
  createdAt: Date = new Date(0);
  metadata: { publishedAt: Date } = { publishedAt: new Date(0) };
  // Set only once the article is archived; absent on a freshly created article.
  archivedAt?: Date;

  ageMs(now: number): number {
    return now - this.createdAt.getTime();
  }

  isPublished(): boolean {
    return this.metadata.publishedAt instanceof Date;
  }
}

// Note the nested path "metadata.publishedAt" and the optional "archivedAt"
// which is undefined on a new article (its conversion is skipped).
const articleSerdes = createClassSerdesWithDates(Article, [
  "createdAt",
  "metadata.publishedAt",
  "archivedAt",
]);

export const handler = withDurableExecution(
  async (event: { title: string }, context: DurableContext) => {
    const created = await context.step(
      "create-article",
      async () => {
        const a = new Article();
        a.title = event.title;
        a.createdAt = new Date("2020-01-01T00:00:00.000Z");
        a.metadata = { publishedAt: new Date("2020-01-02T00:00:00.000Z") };
        // archivedAt intentionally left unset.
        return a;
      },
      { serdes: articleSerdes },
    );

    // Wait forces a replay; `created` is deserialized via articleSerdes, which
    // rehydrates createdAt and metadata.publishedAt into real Date objects.
    await context.wait({ seconds: 1 });

    // These calls only succeed if the Dates and class methods were preserved.
    const inspection = await context.step("inspect-article", async () => ({
      title: created.title,
      createdAtIsDate: created.createdAt instanceof Date,
      publishedAtIsDate: created.metadata.publishedAt instanceof Date,
      isPublished: created.isPublished(),
      ageIsPositive: created.ageMs(Date.parse("2020-01-03T00:00:00.000Z")) > 0,
      archivedAtIsUndefined: created.archivedAt === undefined,
    }));

    return inspection;
  },
);
