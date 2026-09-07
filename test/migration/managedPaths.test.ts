import { describe, expect, it } from "vitest";
import { createManagedPathLayout } from "../../src/migration/managedPaths";

describe("managed path layout", () => {
	it("uses content IDs to disambiguate normalized resource filenames", () => {
		const layout = createManagedPathLayout([{
			course: { id: 1, fullname: "Course" },
			sections: [{
				id: 2,
				modules: [{
					id: 3,
					name: "Resources",
					contents: [
						{ type: "file", id: 10, filename: "slides#final.pdf", fileurl: "https://example.com/one" },
						{ type: "file", id: 11, filename: "slides^final.pdf", fileurl: "https://example.com/two" }
					]
				}]
			}]
		}], { rootFolder: "Moodle", resourcesFolder: "Moodle/_resources" });

		expect(layout.courses[0]?.modules[0]?.resources.map(resource => resource.path)).toEqual([
			"Moodle/_resources/Course (1)/Resources/slides-final (10).pdf",
			"Moodle/_resources/Course (1)/Resources/slides-final (11).pdf"
		]);
	});
});