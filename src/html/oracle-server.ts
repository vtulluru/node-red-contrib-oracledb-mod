//to do: Node RED type definitions
declare var RED_CONFIG: any; // Keep this name to avoid global scope collision

//
// -- oracle server --------------------------------------------------------------------------------
//
RED.nodes.registerType("oracle-server", {
    category: "config",
    defaults: {
        connectionname: { value: "", required: true },
        tnsname: { value: "" },
        connectiontype: { value: "Classic" },
        instantclientpath: { value: "" },
        host: { value: "localhost", required: false },
        port: { value: 1521, required: false, validate: RED.validators.number() },
        db: { value: "", required: false },
        poolmin: { value: 0, required: false, validate: RED.validators.number() },
        poolmax: { value: 4, required: false, validate: RED.validators.number() },
        pooltimeout: { value: 60, required: false, validate: RED.validators.number() },
    },
    credentials: {
        user: { type: "text" },
        password: { type: "password" }
    },
    label: function () {
        return this.connectionname;
    },
    oneditprepare: function () {
        const tabs = RED.tabs.create({
            id: "node-config-oracle-server-tabs",
            onchange: function (tab) {
                $("#node-config-oracle-server-tabs-content").children().hide();
                $("#" + tab.id).show();
            }
        });
        $(".connection-type").hide();
        $("#node-config-input-connectiontype").on("change", function (evt) {
            const ct = (<any>evt.currentTarget);
            if (ct.value === "TNS Name") {
                $("#wallet-container").show();
                $("#classic-container").hide();
                $("#node-config-input-host").val("");
                $("#node-config-input-port").val("");
                $("#node-config-input-db").val("");
            } else {
                $("#wallet-container").hide();
                $("#classic-container").show();
                $("#node-config-input-tnsname").val("");
            }
        }).trigger("change");
        tabs.addTab({
            id: "oracle-server-tab-connection",
            label: "Connection"
        });
        tabs.addTab({
            id: "oracle-server-tab-security",
            label: "Security"
        });
        setTimeout(function () { tabs.resize(); }, 0);
    }
});