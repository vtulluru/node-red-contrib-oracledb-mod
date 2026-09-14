//to do: Node RED type definitions
declare let RED: any;

//
// -- oracledb -------------------------------------------------------------------------------------
//
RED.nodes.registerType("oracledb", {
    category: "storage",
    defaults: {
        name: { value: "" },
        usequery: { value: false},
        query: { value: "INSERT INTO oracleTableName" +
                        "\n\t(fieldName1, fieldName2, Fieldname3)" +
                        "\n\tVALUES (" +
                        "\n\t\t:valueOfValuesArrayIndex0," +
                        "\n\t\t:valueOfValuesArrayIndex1," +
                        "\n\t\t:valueOfValuesArrayIndex2," +
                        "\n\t)"},
        usemappings: { value: false},
        mappings: { value: "[" +
                            "\n\t\"location.of.first.array.index.field.in.msg.payload\"," +
                            "\n\t\"location.of.second.array.index.field\"," +
                            "\n\t\"last_array_indexfield.in[3]\"" +
                            "\n]"},
        server: { type: "oracle-server", required: true },
        resultaction: {value: "multi"},
        resultlimit: {value: 100},
        usemany: {value: false},
        txaction: {value: "auto"}
    },
    inputs: 1,
    outputs: 1,
    color: "#ff6666",
    icon: "db.png",
    align: "right",
    label: function () {
        return this.name || "oracledb";
    },
    labelStyle: function () {
        return this.name ? "node_label_italic" : "";
    },
    oneditprepare: function () {
        // Ensure backwards compatibility for existing nodes loaded from flows
        if (!this.txaction || this.txaction === "") {
            this.txaction = "auto";
            $("#node-input-txaction").val("auto");
        }

        // use query editor
        const queryField = $("#node-input-query");
        const queryEditor = RED.editor.createEditor({
            id: "node-input-query-editor",
            mode: "ace/mode/sql", // unfortunately not yet included in the node-red version of ace
            value: queryField.val()
        });
        queryEditor.getSession().on("change", function() {
          queryField.val(queryEditor.getSession().getValue());
        });

        // use mappings editor
        const mappingsField = $("#node-input-mappings");
        const mappingsEditor = RED.editor.createEditor({
            id: "node-input-mappings-editor",
            mode: "ace/mode/json",
            value: mappingsField.val()
        });
        mappingsEditor.getSession().on("change", function() {
          mappingsField.val(mappingsEditor.getSession().getValue());
        });

        // Schema browser
        const serverSelect = $("#node-input-server");
        const schemaBtn = $("#node-btn-browse-schema");
        const schemaPanel = $("#schema-browser-panel");
        const schemaDbInfo = $("#schema-browser-db-info");
        const schemaStatus = $("#schema-browser-status");
        const schemaList = $("#schema-browser-list");
        const schemaFilter = $("#schema-browser-filter");
        const schemaSelect = $("#schema-browser-schema-select");
        const typeSelect = $("#schema-browser-type-select");
        let allTables: any[] = [];

        function renderTableList(list: any[]) {
            schemaList.empty();
            const textFilter = ((<string>schemaFilter.val()) || "").toUpperCase();
            const selectedSchema = (<string>schemaSelect.val()) || "";
            const selectedType = (<string>typeSelect.val()) || "ALL";

            const filtered = list.filter((t: any) => {
                if (selectedSchema && t.OWNER !== selectedSchema) return false;
                if (selectedType !== "ALL" && t.OBJECT_TYPE !== selectedType) return false;
                if (textFilter && (t.TABLE_NAME || "").toUpperCase().indexOf(textFilter) === -1 && (t.OWNER || "").toUpperCase().indexOf(textFilter) === -1) {
                    return false;
                }
                return true;
            });

            if (!filtered.length) {
                schemaList.html("<div style='padding:6px; color:#999; text-align:center;'>No matching database objects</div>");
                return;
            }

            filtered.forEach((t: any) => {
                const row = $("<div style='border-bottom: 1px solid #edf2f7; margin-bottom: 2px;'></div>");
                const header = $("<div style='padding: 4px 6px; cursor: pointer; display: flex; justify-content: space-between; align-items: center;'></div>");
                const icon = $("<i class='fa fa-caret-right' style='width: 14px; color: #718096;'></i>");
                const isView = (t.OBJECT_TYPE || "") === "VIEW";
                const typeIcon = isView ? "<i class='fa fa-eye' style='color:#3182ce; margin-right:4px;'></i>" : "<i class='fa fa-table' style='color:#e53e3e; margin-right:4px;'></i>";
                const label = $("<span></span>").append(icon).append(" " + typeIcon + "<b>" + t.OWNER + "</b>." + t.TABLE_NAME);
                const tag = $("<span style='color:#718096; font-size:10px; background:#edf2f7; padding:1px 5px; border-radius:3px;'>" + (t.OBJECT_TYPE || "TABLE") + "</span>");
                header.append(label).append(tag);

                header.hover(() => header.css("background", "#ebf8ff"), () => header.css("background", "transparent"));

                const colsBox = $("<div style='display:none; padding: 6px 10px 8px 18px; background: #fff; border-left: 2px solid #3182ce;'></div>");
                let colsLoaded = false;

                header.on("click", (e) => {
                    e.stopPropagation();
                    if (colsBox.is(":visible")) {
                        colsBox.hide();
                        icon.removeClass("fa-caret-down").addClass("fa-caret-right");
                    } else {
                        colsBox.show();
                        icon.removeClass("fa-caret-right").addClass("fa-caret-down");
                        if (!colsLoaded) {
                            colsBox.html("<span style='font-size:11px; color:#888;'><i class='fa fa-spinner fa-spin'></i> Loading columns...</span>");
                            const serverId = serverSelect.val();
                            (<any>$).getJSON("oracle-server/" + serverId + "/columns", { owner: t.OWNER, table: t.TABLE_NAME }, (colData: any) => {
                                colsLoaded = true;
                                if (!colData || !colData.ok || !colData.columns || !colData.columns.length) {
                                    colsBox.html("<span style='font-size:11px; color:#999;'>No columns found</span>");
                                    return;
                                }
                                const cols: any[] = colData.columns;
                                const colNames = cols.map((c: any) => c.COLUMN_NAME);

                                const actionToolbar = $("<div style='margin-bottom: 6px; display: flex; gap: 4px; flex-wrap: wrap;'></div>");
                                const btnSelectAll = $("<button type='button' class='red-ui-button red-ui-button-small' style='padding: 1px 6px; font-size: 10px;'><i class='fa fa-asterisk'></i> SELECT *</button>");
                                btnSelectAll.on("click", (ev) => {
                                    ev.stopPropagation();
                                    const q = "SELECT * FROM " + t.OWNER + "." + t.TABLE_NAME + " FETCH FIRST 100 ROWS ONLY";
                                    queryEditor.getSession().setValue(q);
                                    queryField.val(q);
                                    schemaPanel.hide();
                                });

                                const btnSelectCols = $("<button type='button' class='red-ui-button red-ui-button-small' style='padding: 1px 6px; font-size: 10px;'><i class='fa fa-columns'></i> SELECT cols</button>");
                                btnSelectCols.on("click", (ev) => {
                                    ev.stopPropagation();
                                    const q = "SELECT " + colNames.join(", ") + "\nFROM " + t.OWNER + "." + t.TABLE_NAME + "\nFETCH FIRST 100 ROWS ONLY";
                                    queryEditor.getSession().setValue(q);
                                    queryField.val(q);
                                    schemaPanel.hide();
                                });

                                const insertableCols = cols.filter((c: any) => c.IDENTITY_COLUMN !== "YES" && c.VIRTUAL_COLUMN !== "YES");
                                const insertNames = insertableCols.map((c: any) => c.COLUMN_NAME);

                                const btnInsert = $("<button type='button' class='red-ui-button red-ui-button-small' style='padding: 1px 6px; font-size: 10px;'><i class='fa fa-pencil'></i> INSERT template</button>");
                                btnInsert.on("click", (ev) => {
                                    ev.stopPropagation();
                                    const binds = insertNames.map((c: string) => ":" + c.toLowerCase()).join(", ");
                                    const q = "INSERT INTO " + t.OWNER + "." + t.TABLE_NAME + " (" + insertNames.join(", ") + ")\nVALUES (" + binds + ")";
                                    queryEditor.getSession().setValue(q);
                                    queryField.val(q);
                                    schemaPanel.hide();
                                });

                                actionToolbar.append(btnSelectAll).append(btnSelectCols).append(btnInsert);
                                colsBox.empty().append(actionToolbar);

                                const table = $("<table style='width: 100%; font-size: 11px; border-collapse: collapse;'></table>");
                                cols.forEach((c: any) => {
                                    const tr = $("<tr style='border-bottom: 1px solid #f0f0f0;'></tr>");
                                    const tdName = $("<td style='padding: 2px 4px; font-weight: bold; cursor: pointer; color: #0056b3;' title='Click to insert column name'></td>").text(c.COLUMN_NAME);
                                    tdName.hover(() => tdName.css("text-decoration", "underline"), () => tdName.css("text-decoration", "none"));
                                    tdName.on("click", (ev) => {
                                        ev.stopPropagation();
                                        queryEditor.insert(c.COLUMN_NAME);
                                    });

                                    let typeStr = c.DATA_TYPE || "";
                                    if (c.DATA_PRECISION) {
                                        typeStr += "(" + c.DATA_PRECISION + (c.DATA_SCALE ? "," + c.DATA_SCALE : "") + ")";
                                    } else if (c.DATA_LENGTH && !/LOB|ROWID|DATE/i.test(typeStr)) {
                                        typeStr += "(" + c.DATA_LENGTH + ")";
                                    }
                                    const tdType = $("<td style='padding: 2px 4px; color: #4a5568;'></td>").text(typeStr);
                                    const tdNull = $("<td style='padding: 2px 4px; text-align: right; color: #a0aec0; font-size: 9px;'></td>");
                                    if (c.IDENTITY_COLUMN === "YES") {
                                        tdNull.html("<span style='color:#d69e2e; font-weight:bold; margin-right:4px;'>AUTO</span>" + (c.NULLABLE === "N" ? "NOT NULL" : "NULL"));
                                    } else {
                                        tdNull.text(c.NULLABLE === "N" ? "NOT NULL" : "NULL");
                                    }

                                    tr.append(tdName).append(tdType).append(tdNull);
                                    table.append(tr);
                                });
                                colsBox.append(table);
                            }).fail(() => {
                                colsBox.html("<span style='font-size:11px; color:#c00;'>Error loading columns</span>");
                            });
                        }
                    }
                });

                row.append(header).append(colsBox);
                schemaList.append(row);
            });
        }

        function loadSchemaData(schemaToFilter?: string) {
            const serverId = serverSelect.val();
            if (!serverId || serverId === "_ADD_") {
                schemaStatus.text("Select a deployed Oracle Server first.");
                schemaPanel.show();
                return;
            }
            schemaStatus.html("<i class='fa fa-spinner fa-spin'></i> Loading database schema hierarchy...");
            schemaPanel.show();

            const queryParams: any = {};
            if (schemaToFilter) queryParams.schema = schemaToFilter;

            (<any>$).getJSON("oracle-server/" + serverId + "/tables", queryParams, (data: any) => {
                if (!data || !data.ok) {
                    schemaStatus.text(data && data.error ? data.error : "Failed to load database schema.");
                    return;
                }

                // Display DB Name
                schemaDbInfo.html("<i class='fa fa-database'></i> Database: <b>" + (data.dbName || "Oracle") + "</b>" + (data.currentSchema ? " <span style='color:#718096; font-weight:normal;'>(connected as " + data.currentSchema + ")</span>" : ""));

                // Populate Schemas dropdown if needed
                if (data.schemas && data.schemas.length && schemaSelect.children().length <= 1) {
                    schemaSelect.empty().append("<option value=''>All Schemas (" + data.schemas.length + ")</option>");
                    data.schemas.forEach((s: string) => {
                        schemaSelect.append($("<option></option>").val(s).text(s));
                    });
                    // Auto-select schema if present in current query (e.g. NODERED_HIST.xxx)
                    const currentQueryText = ((<string>queryField.val()) || "").toUpperCase();
                    let matchedSchema = "";
                    data.schemas.forEach((s: string) => {
                        if (currentQueryText.indexOf(s + ".") !== -1) {
                            matchedSchema = s;
                        }
                    });
                    if (matchedSchema) {
                        schemaSelect.val(matchedSchema);
                    } else if (data.currentSchema) {
                        schemaSelect.val(data.currentSchema);
                    }
                }

                allTables = data.tables || [];
                schemaStatus.text(allTables.length + " objects available (expand table to inspect fields)");
                renderTableList(allTables);
            }).fail(() => {
                schemaStatus.text("Error connecting to server endpoint.");
            });
        }

        schemaBtn.on("click", () => loadSchemaData());

        schemaSelect.on("change", () => {
            const chosen = (<string>schemaSelect.val()) || "";
            loadSchemaData(chosen);
        });

        typeSelect.on("change", () => renderTableList(allTables));
        schemaFilter.on("input", () => renderTableList(allTables));
        $("#schema-browser-close").on("click", () => schemaPanel.hide());

        let visibleTab = "query";
        const tabs = RED.tabs.create({
            id: "node-input-oracle-out-tabs",
            onchange: function (tab) {
                $("#node-input-oracle-out-tabs-content").children().hide();
                $("#" + tab.id).show();
                if (tab.id === "oracle-out-tab-query") {
                    visibleTab = "query";
                    functionDialogResize();
                    queryEditor.focus();
                }
                if (tab.id === "oracle-out-tab-mappings") {
                    visibleTab = "mappings";
                    functionDialogResize();
                    mappingsEditor.focus();
                }
            }
        });
        tabs.addTab({
            id: "oracle-out-tab-connection",
            label: "Server connection"
        });
        tabs.addTab({
            id: "oracle-out-tab-query",
            label: "SQL query"
        });
        tabs.addTab({
            id: "oracle-out-tab-mappings",
            label: "Field mappings"
        });
        tabs.addTab({
            id: "oracle-out-tab-results",
            label: "Query results"
        });
        setTimeout(function() { tabs.resize(); }, 0);

        // resize editor areas to fit the edit window
        const functionDialogResize = () => {
            let height = $("#dialog-form").height();
            height -= $("#node-input-oracle-out-tabs").outerHeight(true);
            const rows = $("#oracle-out-tab-" + visibleTab + ">div:not(.node-input-" + visibleTab + "-text-editor-row)");
            for (let i = 0; i < rows.length; i++) {
                height -= $(rows[i]).outerHeight(true);
            }
            const editorRow = $("#dialog-form>div.node-input-" + visibleTab + "-text-editor-row");
            if (editorRow.css("marginTop")) {
                height -= parseInt(editorRow.css("marginTop"), 10);
            }
            if (editorRow.css("marginBottom")) {
                height -= parseInt(editorRow.css("marginBottom"), 10);
            }
            height -= 5;
            $("#node-input-" + visibleTab + "-editor").css("height", height + "px");
            if (visibleTab === "query") {
                queryEditor.resize();
            } else {
                mappingsEditor.resize();
            }
        };
        const d = (<any>$("#dialog"));
        d.on("dialogresize", functionDialogResize);
        d.one("dialogopen", () => {
            const size = d.dialog("option", "sizeCache-function");
            if (size) {
                d.dialog("option", "width", size.width);
                d.dialog("option", "height", size.height);
                functionDialogResize();
            }
        });
        d.one("dialogclose", () => {
            d.off("dialogresize", functionDialogResize);
        });
    }
});