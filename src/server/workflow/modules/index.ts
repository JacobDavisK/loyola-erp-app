// Every module that uses the workflow engine registers itself here. Keep these files free of imports
// from src/server/services/workflow.ts to avoid import cycles.
import "./access";
import "./student-status";
import "./exam";
import "./finance";
import "./hr";
import "./research";
