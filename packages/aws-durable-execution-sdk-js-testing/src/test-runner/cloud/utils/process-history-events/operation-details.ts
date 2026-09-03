import { Operation } from "@aws/durable-execution-sdk-js";
import {
  OperationDetailFields,
  PropertyValueMap,
  Entries,
} from "./operation-types";

/**
 * Adds operation details to an operation object by merging property values.
 * This function safely updates the operation's detail fields with new values,
 * preserving existing properties and only adding defined values.
 *
 * @template DetailsField - The type of the operation detail field being updated
 * @param operation - The operation object to update
 * @param detailsField - The specific detail field to update on the operation
 * @param propertyValueMap - Map of property names to values to add to the detail field
 */
export function addOperationDetails<DetailsField extends OperationDetailFields>(
  operation: Operation,
  detailsField: DetailsField | undefined,
  propertyValueMap: PropertyValueMap<DetailsField>,
) {
  if (!detailsField) {
    return;
  }

  const entries = Object.entries(propertyValueMap) as Entries<
    typeof propertyValueMap
  >;
  for (const [key, value] of entries) {
    if (value === undefined) {
      continue;
    }

    operation[detailsField] = {
      ...operation[detailsField],
      [key]: value,
    };
  }
}
