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
        resultlimit: {value: 100}
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