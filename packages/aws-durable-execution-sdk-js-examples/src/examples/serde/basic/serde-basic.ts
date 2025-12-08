import {
  DurableContext,
  withDurableExecution,
  createClassSerdes,
} from "@aws/durable-execution-sdk-js";
import { ExampleConfig } from "../../../types";

export const config: ExampleConfig = {
  name: "Basic Serdes with createClassSerdes",
  description:
    "Demonstrates using createClassSerdes to preserve class methods across replay. " +
    "Shows how default serdes would lose methods, but createClassSerdes maintains them.",
};

/**
 * User class demonstrating the need for createClassSerdes.
 *
 * IMPORTANT: For createClassSerdes to work, the class must have a
 * no-argument constructor (or all parameters must be optional).
 * This is because createClassSerdes calls `new User()` during deserialization,
 * then uses Object.assign to copy the properties.
 */
class User {
  firstName: string = "";
  lastName: string = "";
  email: string = "";

  constructor(firstName?: string, lastName?: string, email?: string) {
    if (firstName) this.firstName = firstName;
    if (lastName) this.lastName = lastName;
    if (email) this.email = email;
  }

  /**
   * Method that would be lost with default serdes, but preserved with createClassSerdes
   */
  getFullName(): string {
    return `${this.firstName} ${this.lastName}`;
  }

  /**
   * Method that would be lost with default serdes, but preserved with createClassSerdes
   */
  greet(): string {
    return `Hello, I'm ${this.getFullName()}. My email is ${this.email}`;
  }
}

export const handler = withDurableExecution(
  async (
    event: { firstName: string; lastName: string; email: string },
    context: DurableContext,
  ) => {
    // Create custom serdes for User class
    const userSerdes = createClassSerdes(User);

    // Step 1: Create user with createClassSerdes to preserve methods
    // Without this custom serdes, methods would be lost after replay
    const user = await context.step(
      "create-user",
      async () => {
        const newUser = new User(event.firstName, event.lastName, event.email);
        context.logger.info("Created user:", {
          fullName: newUser.getFullName(),
        });
        return newUser;
      },
      { serdes: userSerdes },
    );

    // Wait for 1 second - this forces a replay when resumed
    // On replay, the step above will deserialize using createClassSerdes
    await context.wait({ seconds: 1 });

    // Step 2: Use user methods - works because createClassSerdes preserved them
    // If we had used default serdes, user.greet() would throw "is not a function"
    const greeting = await context.step("greet-user", async () => {
      return user.greet();
    });

    return {
      user: {
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
      },
      greeting,
    };
  },
);
