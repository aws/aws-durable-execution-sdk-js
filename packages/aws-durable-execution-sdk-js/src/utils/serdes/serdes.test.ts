import {
  defaultSerdes,
  createClassSerdes,
  createClassSerdesWithDates,
  Serdes,
  SerdesContext,
} from "./serdes";
import { TEST_CONSTANTS } from "../../testing/test-constants";

const mockContext: SerdesContext = {
  entityId: TEST_CONSTANTS.STEP_ID,
  durableExecutionArn: TEST_CONSTANTS.DURABLE_EXECUTION_ARN,
};

describe("Serdes", () => {
  describe("defaultSerdes", () => {
    it("should serialize and deserialize primitive values", async () => {
      const value = 42;
      const serialized = await defaultSerdes.serialize(value, mockContext);
      const deserialized = await defaultSerdes.deserialize(
        serialized,
        mockContext,
      );
      expect(deserialized).toBe(value);
    });

    it("should serialize and deserialize objects", async () => {
      const value = { name: "test", value: 42 };
      const serialized = await defaultSerdes.serialize(value, mockContext);
      const deserialized = await defaultSerdes.deserialize(
        serialized,
        mockContext,
      );
      expect(deserialized).toEqual(value);
    });

    it("should serialize and deserialize arrays", async () => {
      const value = [1, 2, 3, "test"];
      const serialized = await defaultSerdes.serialize(value, mockContext);
      const deserialized = await defaultSerdes.deserialize(
        serialized,
        mockContext,
      );
      expect(deserialized).toEqual(value);
    });

    it("should serialize and deserialize nested objects", async () => {
      const value = {
        name: "test",
        nested: {
          value: 42,
          array: [1, 2, 3],
        },
      };
      const serialized = await defaultSerdes.serialize(value, mockContext);
      const deserialized = await defaultSerdes.deserialize(
        serialized,
        mockContext,
      );
      expect(deserialized).toEqual(value);
    });

    it("should serialize and deserialize undefined", async () => {
      const serialized = await defaultSerdes.serialize(undefined, mockContext);
      const deserialized = await defaultSerdes.deserialize(
        undefined,
        mockContext,
      );
      expect(deserialized).toBeUndefined();
      expect(serialized).toBeUndefined();
    });
  });

  describe("createClassSerdes", () => {
    class TestClass {
      name: string = "";
      value: number = 0;

      constructor(name?: string, value?: number) {
        if (name) this.name = name;
        if (value !== undefined) this.value = value;
      }

      getFullName(): string {
        return `${this.name}-${this.value}`;
      }
    }

    it("should preserve class instance methods after serialization", async () => {
      const testSerdes = createClassSerdes(TestClass);
      const instance = new TestClass("test", 42);

      const serialized = await testSerdes.serialize(instance, mockContext);
      const deserialized = await testSerdes.deserialize(
        serialized,
        mockContext,
      );

      expect(deserialized).toBeInstanceOf(TestClass);
      expect(deserialized?.name).toBe("test");
      expect(deserialized?.value).toBe(42);
      expect(deserialized?.getFullName()).toBe("test-42");
    });

    it("should handle empty class instances", async () => {
      const testSerdes = createClassSerdes(TestClass);
      const instance = new TestClass();

      const serialized = await testSerdes.serialize(instance, mockContext);
      const deserialized = await testSerdes.deserialize(
        serialized,
        mockContext,
      );

      expect(deserialized).toBeInstanceOf(TestClass);
      expect(deserialized?.name).toBe("");
      expect(deserialized?.value).toBe(0);
      expect(deserialized?.getFullName()).toBe("-0");
    });

    it("should handle undefined class instance", async () => {
      const testSerdes = createClassSerdes(TestClass);
      const serialized = await testSerdes.serialize(undefined, mockContext);
      const deserialized = await testSerdes.deserialize(undefined, mockContext);
      expect(serialized).toBeUndefined();
      expect(deserialized).toBeUndefined();
    });

    it("should handle class instances with Date properties", async () => {
      class ClassWithDate {
        name: string = "";
        createdAt: Date;

        constructor(name?: string) {
          if (name) this.name = name;
          this.createdAt = new Date();
        }

        getAge(): number {
          return Date.now() - this.createdAt.getTime();
        }
      }

      const dateSerdes = createClassSerdes(ClassWithDate);
      const instance = new ClassWithDate("test");

      // Ensure the date is properly serialized
      const serialized = await dateSerdes.serialize(instance, mockContext);

      // The serialized string should contain the date in ISO format
      expect(serialized).toContain('"createdAt":"');

      // When deserialized, the createdAt property will be a string, not a Date
      const deserialized = await dateSerdes.deserialize(
        serialized,
        mockContext,
      );

      expect(deserialized).toBeInstanceOf(ClassWithDate);
      expect(deserialized?.name).toBe("test");

      // The getAge method will fail because createdAt is not a Date object
      expect(() => deserialized?.getAge()).toThrow();
    });
  });

  describe("createClassSerdesWithDates", () => {
    class ClassWithDate {
      name: string = "";
      createdAt: Date;
      updatedAt: Date | null = null;

      constructor(name?: string) {
        if (name) this.name = name;
        this.createdAt = new Date();
      }

      getAge(): number {
        return Date.now() - this.createdAt.getTime();
      }

      update(): void {
        this.updatedAt = new Date();
      }
    }

    it("should properly handle Date properties", async () => {
      const dateSerdes = createClassSerdesWithDates(ClassWithDate, [
        "createdAt",
        "updatedAt",
      ]);
      const instance = new ClassWithDate("test");
      instance.update(); // Set updatedAt

      const serialized = await dateSerdes.serialize(instance, mockContext);
      const deserialized = await dateSerdes.deserialize(
        serialized,
        mockContext,
      );

      expect(deserialized).toBeInstanceOf(ClassWithDate);
      expect(deserialized?.name).toBe("test");
      expect(deserialized?.createdAt).toBeInstanceOf(Date);
      expect(deserialized?.updatedAt).toBeInstanceOf(Date);

      // The getAge method should work because createdAt is properly a Date
      expect(typeof deserialized?.getAge()).toBe("number");
      expect(deserialized?.getAge()).toBeGreaterThanOrEqual(0);
    });

    it("should handle null Date properties", async () => {
      const dateSerdes = createClassSerdesWithDates(ClassWithDate, [
        "createdAt",
        "updatedAt",
      ]);
      const instance = new ClassWithDate("test");
      // Don't call update(), so updatedAt remains null

      const serialized = await dateSerdes.serialize(instance, mockContext);
      const deserialized = await dateSerdes.deserialize(
        serialized,
        mockContext,
      );

      expect(deserialized).toBeInstanceOf(ClassWithDate);
      expect(deserialized?.createdAt).toBeInstanceOf(Date);
      expect(deserialized?.updatedAt).toBeNull();
    });

    it("should handle missing Date properties", async () => {
      const dateSerdes = createClassSerdesWithDates(ClassWithDate, [
        "createdAt",
        "updatedAt",
        "nonExistentDate",
      ]);
      const instance = new ClassWithDate("test");

      const serialized = await dateSerdes.serialize(instance, mockContext);
      const deserialized = await dateSerdes.deserialize(
        serialized,
        mockContext,
      );

      expect(deserialized).toBeInstanceOf(ClassWithDate);
      expect(deserialized?.createdAt).toBeInstanceOf(Date);
      // Should not throw an error for non-existent property
    });

    it("should handle undefined date", async () => {
      const dateSerdes = createClassSerdesWithDates(ClassWithDate, [
        "createdAt",
        "updatedAt",
      ]);
      const serialized = await dateSerdes.serialize(undefined, mockContext);
      const deserialized = await dateSerdes.deserialize(undefined, mockContext);
      expect(serialized).toBeUndefined();
      expect(deserialized).toBeUndefined();
    });

    it("should handle nested Date properties", async () => {
      class ClassWithNestedDate {
        name: string = "";
        metadata: {
          createdAt: Date;
          updatedAt: Date;
        };
        user: {
          profile: {
            lastLogin: Date;
          };
        };

        constructor() {
          this.metadata = {
            createdAt: new Date("2024-01-01"),
            updatedAt: new Date("2024-01-02"),
          };
          this.user = {
            profile: {
              lastLogin: new Date("2024-01-03"),
            },
          };
        }
      }

      const dateSerdes = createClassSerdesWithDates(ClassWithNestedDate, [
        "metadata.createdAt",
        "metadata.updatedAt",
        "user.profile.lastLogin",
      ]);
      const instance = new ClassWithNestedDate();
      instance.name = "test";

      const serialized = await dateSerdes.serialize(instance, mockContext);
      const deserialized = await dateSerdes.deserialize(
        serialized,
        mockContext,
      );

      expect(deserialized).toBeInstanceOf(ClassWithNestedDate);
      expect(deserialized?.name).toBe("test");
      expect(deserialized?.metadata.createdAt).toBeInstanceOf(Date);
      expect(deserialized?.metadata.updatedAt).toBeInstanceOf(Date);
      expect(deserialized?.user.profile.lastLogin).toBeInstanceOf(Date);
      expect(deserialized?.metadata.createdAt.toISOString()).toBe(
        "2024-01-01T00:00:00.000Z",
      );
      expect(deserialized?.metadata.updatedAt.toISOString()).toBe(
        "2024-01-02T00:00:00.000Z",
      );
      expect(deserialized?.user.profile.lastLogin.toISOString()).toBe(
        "2024-01-03T00:00:00.000Z",
      );
    });

    it("should handle missing nested paths gracefully", async () => {
      class ClassWithOptionalNested {
        metadata?: {
          createdAt: Date;
        };
      }

      const dateSerdes = createClassSerdesWithDates(ClassWithOptionalNested, [
        "metadata.createdAt",
      ]);
      const instance = new ClassWithOptionalNested();
      // metadata is undefined

      const serialized = await dateSerdes.serialize(instance, mockContext);
      const deserialized = await dateSerdes.deserialize(
        serialized,
        mockContext,
      );

      expect(deserialized).toBeInstanceOf(ClassWithOptionalNested);
      expect(deserialized?.metadata).toBeUndefined();
      // Should not throw an error
    });
  });

  describe("Custom Async Serdes", () => {
    it("should support custom async serdes implementations", async () => {
      // Create a custom async serdes that adds delay and transforms data
      const customAsyncSerdes: Serdes<{ value: number }> = {
        serialize: async (value) => {
          if (value === undefined) return undefined;

          // Simulate async operation with delay
          await new Promise((resolve) => setTimeout(resolve, 10));

          // Transform data during serialization
          return JSON.stringify({ transformedValue: value.value * 2 });
        },

        deserialize: async (data) => {
          if (data === undefined) return undefined;

          // Simulate async operation with delay
          await new Promise((resolve) => setTimeout(resolve, 10));

          // Transform data back during deserialization
          const parsed = JSON.parse(data);
          return { value: parsed.transformedValue / 2 };
        },
      };

      const originalValue = { value: 42 };
      const serialized = await customAsyncSerdes.serialize(
        originalValue,
        mockContext,
      );
      const deserialized = await customAsyncSerdes.deserialize(
        serialized,
        mockContext,
      );

      expect(serialized).toContain('"transformedValue":84');
      expect(deserialized).toEqual(originalValue);
    });

    it("should handle async serialization errors", async () => {
      const errorSerdes: Serdes<any> = {
        serialize: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          throw new Error("Async serialization failed");
        },
        deserialize: async (data) => data,
      };

      await expect(
        errorSerdes.serialize({ test: "data" }, mockContext),
      ).rejects.toThrow("Async serialization failed");
    });

    it("should handle async deserialization errors", async () => {
      const errorSerdes: Serdes<any> = {
        serialize: async (value) => JSON.stringify(value),
        deserialize: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          throw new Error("Async deserialization failed");
        },
      };

      await expect(
        errorSerdes.deserialize('{"test":"data"}', mockContext),
      ).rejects.toThrow("Async deserialization failed");
    });
  });
});
